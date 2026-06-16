const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
    POOP_TYPES,
    extractDeviceInfo,
    mapRecord,
    toDateKey,
    parseDateKey,
    getWeekRange,
    daysBetween,
    getWeekNumber,
    calculateStreak,
    computeStats,
    formatDurationSec,
    parseFilterQuery
} = require('./lib/utils');
const { authenticateToken, requireAdmin } = require('./lib/middleware');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'poop-reminder-secret-key';

const db = new Database('poopreminder.db');

// -------- 数据库初始化 --------
function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            poop_type INTEGER,
            duration INTEGER DEFAULT 0,
            status TEXT,
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            device_ip TEXT,
            device_user_agent TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
        CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
    `);

    // 向后兼容：旧库可能缺少新字段
    const pragma = db.prepare("PRAGMA table_info(records)");
    const columns = pragma.all();

    const addColumnIfMissing = (col, def, table = 'records') => {
        const info = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!info.some(c => c.name === col)) {
            try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
            catch (e) { console.log(`列 ${col} 添加失败:`, e.message); }
        }
    };
    addColumnIfMissing('poop_type', 'INTEGER');
    addColumnIfMissing('duration', 'INTEGER DEFAULT 0');
    addColumnIfMissing('status', 'TEXT');
    addColumnIfMissing('created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    addColumnIfMissing('role', 'TEXT NOT NULL DEFAULT \'user\'', 'users');
}

initializeDatabase();

// -------- 开发模式测试账号自动填充 --------
// 环境变量 NODE_ENV=development 或未设置时自动创建测试账号。
// 若数据库中已有邮箱为 test@example.com 的账号，直接复用；
// 若没有但存在 username=test 的账号（历史脏数据），就把它重置为标准测试账号；
// 否则新建一条测试账号。
const TEST_EMAIL = 'test@example.com';
const TEST_USERNAME = 'test';
const TEST_PASSWORD = 'test123';

const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
if (IS_DEV) {
    try {
        const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(TEST_EMAIL);
        let testUserId;
        const testPwd = bcrypt.hashSync(TEST_PASSWORD, 10);

        if (byEmail) {
            // 已有 test@example.com：重置密码为 test123，确保可登录
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(testPwd, byEmail.id);
            testUserId = byEmail.id;
            console.log(`👤 测试账号已就绪: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
        } else {
            const existingTest = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USERNAME);
            if (existingTest) {
                // 历史账号 username=test：把它重置为标准测试账号
                db.prepare('UPDATE users SET email = ?, password = ? WHERE id = ?').run(TEST_EMAIL, testPwd, existingTest.id);
                testUserId = existingTest.id;
                console.log(`👤 测试账号已重置为: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
            } else {
                const ins = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');
                const res = ins.run(TEST_USERNAME, TEST_EMAIL, testPwd);
                testUserId = res.lastInsertRowid;
                console.log(`👤 测试账号已创建: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
            }
        }

        // 为测试账号填充最近 7 天的示例数据
        const recordCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE user_id = ?').get(testUserId).c;
        if (recordCount === 0) {
            const insRec = db.prepare('INSERT INTO records (user_id, date, notes, poop_type, duration, status) VALUES (?, ?, ?, ?, ?, ?)');
            const types = [3, 4, 4, 5, 4, 3, 2];
            const notes = ['正常', '有点干', '正常', '偏软', '正常', '晨起', '偏稀'];
            const statuses = ['正常', '正常', '顺畅', '正常', '正常', '偏慢', '有点费力'];
            const durations = [300, 420, 240, 480, 300, 600, 360]; // 单位：秒
            for (let i = 0; i < 7; i++) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                insRec.run(testUserId, dateStr, notes[i], types[i], durations[i], statuses[i]);
            }
            console.log('📋 已为测试账号填充 7 条示例记录');
        }
    } catch (e) {
        console.log('测试账号创建失败:', e.message);
    }

    // -------- admin 管理员账号（每次启动都确保存在并可登录） --------
    try {
        const ADMIN_EMAIL = 'admin@example.com';
        const ADMIN_USERNAME = 'admin';
        const ADMIN_PASSWORD = 'admin123';
        const adminPwd = bcrypt.hashSync(ADMIN_PASSWORD, 10);

        const adminByEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
        const adminByUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME);
        const adminId = (adminByEmail && adminByEmail.id) || (adminByUsername && adminByUsername.id);

        if (adminId) {
            db.prepare('UPDATE users SET role = ?, email = ?, password = ?, username = ? WHERE id = ?').run('admin', ADMIN_EMAIL, adminPwd, ADMIN_USERNAME, adminId);
            console.log(`🛡  管理员账号已就绪: ${ADMIN_USERNAME}/${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
        } else {
            const ins = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)');
            const r = ins.run(ADMIN_USERNAME, ADMIN_EMAIL, adminPwd, 'admin');
            console.log(`🛡  管理员账号已创建: ${ADMIN_USERNAME}/${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
        }
    } catch (e) {
        console.log('管理员账号创建失败:', e.message);
    }
}

// -------- 数据库绑定与路由逻辑（纯函数见 lib/utils.js，认证中间件见 lib/middleware.js） --------

// 计算连续打卡天数（数据库绑定版本：复用 utils 中的纯函数 calculateStreak）
function calculateStreakForUser(userId) {
    const records = db.prepare("SELECT date FROM records WHERE user_id = ? ORDER BY date DESC").all(userId);
    if (records.length === 0) return 0;
    return calculateStreak(records.map(r => r.date));
}

// 查询：用户 + 起止时间 + 可选类型筛选
// 关键点：records.date 存储为 ISO-UTC（由 recordDate.toISOString() 写入）。
// 我们统一以"本地日期 YYYY-MM-DD"进行比较，避免跨时区把 00:xx 的记录归到前一天。
function queryRecords(userId, { start, end, poopType } = {}) {
    const startKey = start ? (start instanceof Date
        ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
        : toDateKey(start)) : null;
    const endKey = end ? (end instanceof Date
        ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
        : toDateKey(end)) : null;

    const conds = ['r.user_id = ?'];
    const params = [userId];
    if (startKey) { conds.push("date(r.date, 'localtime') >= ?"); params.push(startKey); }
    if (endKey) { conds.push("date(r.date, 'localtime') < ?"); params.push(endKey); }
    if (poopType) { conds.push('r.poop_type = ?'); params.push(poopType); }

    const sql = `SELECT r.* FROM records r WHERE ${conds.join(' AND ')} ORDER BY COALESCE(r.created_at, r.date) DESC, r.date DESC`;
    return db.prepare(sql).all(...params).map(mapRecord);
}

// -------- 公共路由 --------
app.use(cors());
app.use(express.json());

// API 路由放在静态资源之前，避免静态 fallback 误匹配
app.get('/api/poop-types', (req, res) => res.json({ types: POOP_TYPES }));

// 注册 / 登录
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
    try {
        if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: '该邮箱已被注册' });
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(400).json({ error: '该用户名已被使用' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = db.prepare('INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, ?)').run(username, email, hashedPassword, new Date().toISOString());
        const token = jwt.sign({ userId: result.lastInsertRowid, username, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token, user: { id: result.lastInsertRowid, username, email, role: 'user' } });
    } catch (err) { res.status(500).json({ error: '注册失败，请稍后重试' }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '请输入账号和密码' });
    try {
        // 支持邮箱或用户名两种方式登录
        const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
        if (!user) return res.status(401).json({ error: '账号或密码错误' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: '账号或密码错误' });
        const role = user.role || 'user';
        const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, role } });
    } catch (err) { res.status(500).json({ error: '登录失败，请稍后重试' }); }
});

// -------- 需认证的路由 --------
app.get('/api/user', authenticateToken, (req, res) => {
    try {
        const user = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: '获取用户信息失败' }); }
});

app.get('/api/home', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const records = queryRecords(userId).slice(0, 5);
    // 近 7 天简易统计
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);
    const last7 = queryRecords(userId, { start: weekAgo });
    const poopTypeStats = {};
    last7.forEach(r => {
        const key = String(r.poopType || 0);
        poopTypeStats[key] = (poopTypeStats[key] || 0) + 1;
    });
    res.json({
        streak: calculateStreakForUser(userId),
        records,
        last7: { count: last7.length, poopTypeStats }
    });
});

app.get('/api/history', authenticateToken, (req, res) => {
    res.json({ records: queryRecords(req.user.userId) });
});

// 写入一条记录：支持 date / poop_type / notes / duration / status
app.post('/api/record', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const device = extractDeviceInfo(req);

    const rawPoopType = req.body.poop_type;
    if (rawPoopType === undefined || rawPoopType === null || rawPoopType === '') {
        return res.status(400).json({ error: '请先选择大便类型' });
    }
    const poopType = parseInt(rawPoopType, 10);
    if (isNaN(poopType) || poopType < 1 || poopType > 7) {
        return res.status(400).json({ error: '请选择有效的大便类型（1-7型）' });
    }

    const duration = req.body.duration ? parseInt(req.body.duration, 10) : 0;
    const validDuration = (!isNaN(duration) && duration >= 0 && duration < 24 * 60 * 60) ? duration : 0;
    const notes = (req.body.notes || '').toString().slice(0, 500);
    const status = (req.body.status || '').toString().slice(0, 50);

    // 允许前端指定时间：使用 date（ISO 字符串），否则使用当前时间
    let recordDate = new Date();
    let isLocal = true; // 是否为“真实的本地时刻”（true 时不强制限制到今天）
    if (req.body.date) {
        const parsed = parseDateKey(req.body.date);
        if (!parsed) {
            return res.status(400).json({ error: '日期格式无效' });
        }
        // 用户显式传入日期时，判定为“补充记录”，不允许晚于“今天结束”。
        // 以服务器本地时间为准：今晚 23:59:59.999 为上限，避免跨时区导致正常记录被拒。
        const now = new Date();
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        if (parsed.getTime() > endOfToday.getTime()) {
            return res.status(400).json({ error: '日期不能晚于今天' });
        }
        recordDate = parsed;
        isLocal = false;
    } else {
        // 自动写入的“此刻”记录：也不能晚于服务器当前时刻（兜底）
        const now = new Date();
        if (recordDate.getTime() > now.getTime() + 1000) {
            recordDate = now;
        }
    }
    // 将 recordDate 以其 UTC 日期部分作为字符串存库（格式 YYYY-MM-DDTHH:mm:ss.sssZ）
    // —— 由于 parseDateKey 会把 YYYY-MM-DD 解析成本地 0 点；ISO 化后仍可被 toDateKey 还原日期。

    try {
        const insertStmt = db.prepare(`
            INSERT INTO records (
                user_id, date, notes, poop_type, duration, status,
                device_type, device_browser, device_os, device_model, device_ip, device_user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = insertStmt.run(
            userId, recordDate.toISOString(), notes, poopType, validDuration, status,
            device.type, device.browser, device.os, device.model, device.ip, device.userAgent
        );
        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
        res.json({ success: true, record: mapRecord(record) });
    } catch (err) {
        res.status(500).json({ error: '记录失败，请稍后重试' });
    }
});

// 更新记录（用于修改类型/时长/状态/备注）
app.put('/api/record/:id', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const id = parseInt(req.params.id);
    try {
        const existing = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, userId);
        if (!existing) return res.status(404).json({ error: '记录不存在' });

        let poopType = existing.poop_type;
        if (req.body.poop_type !== undefined && req.body.poop_type !== null) {
            const pt = parseInt(req.body.poop_type, 10);
            if (!isNaN(pt) && pt >= 1 && pt <= 7) poopType = pt;
            else return res.status(400).json({ error: '无效的大便类型' });
        }

        let duration = existing.duration || 0;
        if (req.body.duration !== undefined) {
            const d = parseInt(req.body.duration, 10);
            if (!isNaN(d) && d >= 0 && d < 24 * 60 * 60) duration = d;
            else return res.status(400).json({ error: '无效的持续时长' });
        }

        const notes = req.body.notes !== undefined ? req.body.notes.toString().slice(0, 500) : existing.notes;
        const status = req.body.status !== undefined ? req.body.status.toString().slice(0, 50) : existing.status;

        // 允许前端修改时间
        let recordDate = existing.date;
        if (req.body.date) {
            const parsed = parseDateKey(req.body.date);
            if (parsed) recordDate = parsed.toISOString();
        }

        db.prepare(`
            UPDATE records SET date=?, notes=?, poop_type=?, duration=?, status=? WHERE id=? AND user_id=?
        `).run(recordDate, notes, poopType, duration, status, id, userId);

        const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
        res.json({ success: true, record: mapRecord(updated) });
    } catch (err) { res.status(500).json({ error: '更新失败，请稍后重试' }); }
});

app.delete('/api/delete/:id', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const id = parseInt(req.params.id);
    try {
        const record = db.prepare('SELECT user_id FROM records WHERE id = ?').get(id);
        if (!record) return res.status(404).json({ error: '记录不存在' });
        if (record.user_id !== userId) return res.status(403).json({ error: '无权限删除此记录' });
        db.prepare('DELETE FROM records WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: '删除失败，请稍后重试' }); }
});

// -------- 周/月视图 + 筛选 + 导出 --------
// 注：formatDurationSec 与 parseFilterQuery 纯函数已提取到 lib/utils.js


// GET /api/weekly?date=YYYY-MM-DD   — 该周的每日数据
app.get('/api/weekly', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const base = parseDateKey(req.query.date) || new Date();
    const { start, end } = getWeekRange(base);
    const filter = parseFilterQuery(req.query);
    // 周视图默认只看该周
    const records = queryRecords(userId, {
        start: filter.start || start,
        end: filter.end || end,
        poopType: filter.poopType
    });

    // 构造 7 天格子
    const days = daysBetween(start, end);
    const byDay = {};
    days.forEach(d => {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        byDay[key] = { date: key, items: [], count: 0, totalDuration: 0, typeCounts: {} };
    });

    records.forEach(r => {
        const key = toDateKey(r.date);
        if (key && byDay[key]) {
            byDay[key].items.push(r);
            byDay[key].count++;
            if (r.duration && r.duration > 0) byDay[key].totalDuration += r.duration;
            byDay[key].typeCounts[r.poopType || 0] = (byDay[key].typeCounts[r.poopType || 0] || 0) + 1;
        }
    });

    const dailyList = Object.values(byDay).map(d => ({
        date: d.date, count: d.count,
        avgDuration: d.count ? Math.round(d.totalDuration / d.count) : 0,
        typeCounts: d.typeCounts
    }));

    const totalCount = dailyList.reduce((s, d) => s + d.count, 0);
    const totalDuration = dailyList.reduce((s, d) => s + d.count * d.avgDuration, 0);
    const typeStats = {};
    dailyList.forEach(d => {
        Object.keys(d.typeCounts).forEach(t => {
            typeStats[t] = (typeStats[t] || 0) + d.typeCounts[t];
        });
    });

    res.json({
        range: { start: start.toISOString(), end: end.toISOString() },
        weekLabel: `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`,
        days: dailyList,
        summary: {
            totalCount,
            avgDuration: totalCount ? Math.round(totalDuration / totalCount) : 0,
            avgPerDay: Math.round((totalCount / 7) * 10) / 10,
            typeStats
        },
        records
    });
});

// GET /api/monthly?date=YYYY-MM
app.get('/api/monthly', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    let base;
    if (req.query.date && /^\d{4}-\d{1,2}$/.test(req.query.date)) {
        const [y, m] = req.query.date.split('-').map(Number);
        base = new Date(y, m - 1, 1);
    } else {
        base = new Date();
    }
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);

    const filter = parseFilterQuery(req.query);
    const records = queryRecords(userId, {
        start: filter.start || start,
        end: filter.end || end,
        poopType: filter.poopType
    });

    // 日历：按天格子
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const byDay = {};
    for (let i = 1; i <= daysInMonth; i++) {
        const key = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        byDay[key] = { date: key, count: 0, totalDuration: 0, typeCounts: {} };
    }
    records.forEach(r => {
        const key = toDateKey(r.date);
        if (key && byDay[key]) {
            byDay[key].count++;
            if (r.duration && r.duration > 0) byDay[key].totalDuration += r.duration;
            byDay[key].typeCounts[r.poopType || 0] = (byDay[key].typeCounts[r.poopType || 0] || 0) + 1;
        }
    });

    const dailyList = Object.values(byDay).map(d => ({
        date: d.date, count: d.count,
        avgDuration: d.count ? Math.round(d.totalDuration / d.count) : 0,
        typeCounts: d.typeCounts
    }));

    // 周对比：每月拆分的自然周（从月首周一起算到月末）
    const weekBuckets = [];
    let currentWeekStart = new Date(start);
    while (currentWeekStart < end) {
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(currentWeekStart.getDate() + 7);
        const realEnd = weekEnd < end ? weekEnd : end;
        let count = 0, totalDuration = 0;
        const typeStats = {};
        dailyList.forEach(d => {
            const dayDate = new Date(d.date);
            if (dayDate >= currentWeekStart && dayDate < realEnd) {
                count += d.count;
                totalDuration += d.count * d.avgDuration;
                Object.keys(d.typeCounts).forEach(t => {
                    typeStats[t] = (typeStats[t] || 0) + d.typeCounts[t];
                });
            }
        });
        weekBuckets.push({
            start: currentWeekStart.toISOString(),
            end: realEnd.toISOString(),
            label: `${currentWeekStart.getMonth() + 1}/${currentWeekStart.getDate()} - ${realEnd.getMonth() + 1}/${realEnd.getDate()}`,
            count,
            avgDuration: count ? Math.round(totalDuration / count) : 0,
            typeStats
        });
        currentWeekStart = weekEnd;
    }

    // 月度趋势（与上月对比）
    const prevStart = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    const prevEnd = new Date(base.getFullYear(), base.getMonth(), 1);
    const prevRecords = queryRecords(userId, { start: prevStart, end: prevEnd, poopType: filter.poopType });
    const currentCount = dailyList.reduce((s, d) => s + d.count, 0);
    const totalDuration = dailyList.reduce((s, d) => s + d.count * d.avgDuration, 0);
    const typeStats = {};
    dailyList.forEach(d => {
        Object.keys(d.typeCounts).forEach(t => {
            typeStats[t] = (typeStats[t] || 0) + d.typeCounts[t];
        });
    });

    res.json({
        month: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`,
        range: { start: start.toISOString(), end: end.toISOString() },
        days: dailyList,
        weeks: weekBuckets,
        summary: {
            totalCount: currentCount,
            avgDuration: currentCount ? Math.round(totalDuration / currentCount) : 0,
            avgPerDay: Math.round((currentCount / daysInMonth) * 10) / 10,
            typeStats
        },
        compareWithLastMonth: {
            count: prevRecords.length,
            diff: prevRecords.length ? Math.round((currentCount - prevRecords.length) / prevRecords.length * 100) : 0
        },
        records
    });
});

// 筛选接口：支持任意日期范围 + 类型筛选，返回记录和统计
app.get('/api/records', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const filter = parseFilterQuery(req.query);
    const records = queryRecords(userId, filter);
    const stats = computeStats(records);
    res.json({ records, stats, filter: {
        start: filter.start ? filter.start.toISOString() : null,
        end: filter.end ? filter.end.toISOString() : null,
        poopType: filter.poopType || null
    }});
});

// 导出为 CSV（Excel 可直接打开）
app.get('/api/export', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const format = (req.query.format || 'csv').toString().toLowerCase();
    const range = req.query.range || 'month'; // week | month | all
    const now = new Date();
    let start, end, fileName;
    if (range === 'week') {
        const wr = getWeekRange(now);
        start = wr.start; end = wr.end;
        fileName = `weekly_${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}${String(start.getDate()).padStart(2, '0')}`;
    } else if (range === 'all') {
        start = null; end = null;
        fileName = 'all_records';
    } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        fileName = `monthly_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const filter = parseFilterQuery(req.query);
    const records = queryRecords(userId, {
        start: filter.start || start,
        end: filter.end || end,
        poopType: filter.poopType
    });

    if (format === 'txt') {
        const lines = [];
        lines.push(`拉屎记录导出 - ${new Date().toLocaleString('zh-CN')}`);
        lines.push(`共 ${records.length} 条记录`);
        lines.push('');
        records.forEach((r, i) => {
            const d = new Date(r.date);
            lines.push(`${i + 1}. ${d.toLocaleString('zh-CN')}`);
            const type = POOP_TYPES.find(t => t.id === r.poopType);
            lines.push(`   类型: ${type ? `${type.emoji} ${type.name} - ${type.description}` : '未记录'}`);
            lines.push(`   时长: ${r.duration ? formatDurationSec(r.duration) : '未记录'}`);
            if (r.status) lines.push(`   状态: ${r.status}`);
            if (r.notes) lines.push(`   备注: ${r.notes}`);
            lines.push('');
        });
        const stats = computeStats(records);
        lines.push('===== 统计 =====');
        lines.push(`总次数: ${stats.total}`);
        lines.push(`平均时长: ${formatDurationSec(stats.avgDuration)}`);
        POOP_TYPES.forEach(t => {
            const c = stats.typeCounts[t.id] || 0;
            lines.push(`${t.emoji} ${t.name}: ${c} 次`);
        });
        const txt = '\uFEFF' + lines.join('\n');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
        res.send(txt);
        return;
    }

    // CSV 默认
    const rows = [
        ['日期', '时间', '类型编号', '类型名称', '描述', '持续时长(秒)', '状态', '备注']
    ];
    records.forEach(r => {
        const d = new Date(r.date);
        const type = POOP_TYPES.find(t => t.id === r.poopType);
        rows.push([
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            r.poopType || '',
            type ? type.name : '',
            type ? type.description : '',
            r.duration || 0,
            r.status || '',
            (r.notes || '').replace(/\s+/g, ' ')
        ]);
    });
    const escape = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + rows.map(r => r.map(escape).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.csv"`);
    res.send(csv);
});

// 设置
app.get('/api/settings', authenticateToken, (req, res) => res.json({ hour: 8, minute: 0 }));
app.post('/api/settings', authenticateToken, (req, res) => {
    const hour = parseInt(req.body.hour);
    const minute = parseInt(req.body.minute);
    res.json({ success: true, reminderTime: { hour, minute } });
});

// 静态资源 + SPA fallback：
// 1. /assets/ 下的文件使用 hash 命名，强缓存 1 年；找不到直接 404（text/plain），绝不再回落到 index.html
// 2. index.html 加 no-cache，避免浏览器长期缓存旧的资源引用
// 3. 其他 GET 请求（不带扩展名的路径，如 /weekly、/history）才回落到 index.html
const DIST_DIR = path.join(__dirname, 'frontend/dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

const ASSET_MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8'
};

app.use('/assets', (req, res) => {
    const relPath = req.path.substring(1); // 去掉前面的斜杠
    const filePath = path.join(ASSETS_DIR, relPath);
    const ext = path.extname(filePath).toLowerCase();
    fs.stat(filePath, (err, stat) => {
        if (err || !stat || !stat.isFile()) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(404).send('Not found: ' + req.originalUrl);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (ASSET_MIME[ext]) res.setHeader('Content-Type', ASSET_MIME[ext]);
        res.sendFile(filePath);
    });
});

app.use(express.static(DIST_DIR, {
    setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
    }
}));

app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    const ext = path.extname(req.path).toLowerCase();
    if (ext !== '' && ext !== '.html') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(404).send('Not found: ' + req.path);
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// -------- 管理员 API --------
// 所有用户列表（含记录数）
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
    try {
        const users = db.prepare(`
            SELECT u.id, u.username, u.email, u.role, u.created_at,
                   COUNT(r.id) as record_count
            FROM users u
            LEFT JOIN records r ON r.user_id = u.id
            GROUP BY u.id
            ORDER BY u.id DESC
        `).all();
        res.json({ users });
    } catch (err) { res.status(500).json({ error: '查询失败' }); }
});

// 所有用户的记录（支持按 user_id、日期范围、类型筛选）
app.get('/api/admin/records', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { user_id, start, end, poop_type, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (user_id) { conds.push('r.user_id = ?'); params.push(user_id); }
        if (start) { conds.push('r.date >= ?'); params.push(start); }
        if (end) { conds.push('r.date <= ?'); params.push(end); }
        if (poop_type) { conds.push('r.poop_type = ?'); params.push(poop_type); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

        const total = db.prepare(`
            SELECT COUNT(*) as c FROM records r ${where}
        `).get(...params).c;

        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const records = db.prepare(`
            SELECT r.*, u.username as user_username, u.email as user_email
            FROM records r
            LEFT JOIN users u ON u.id = r.user_id
            ${where}
            ORDER BY r.date DESC
            LIMIT ? OFFSET ?
        `).all(...params, lim, off);

        const mapped = records.map(r => ({
            id: r.id,
            userId: r.user_id,
            username: r.user_username,
            email: r.user_email,
            date: r.date,
            notes: r.notes,
            poopType: r.poop_type,
            duration: r.duration || 0,
            status: r.status
        }));

        // 统计信息
        const stats = db.prepare(`
            SELECT
                COUNT(*) as total,
                AVG(CASE WHEN r.duration > 0 THEN r.duration END) as avg_duration,
                r.poop_type as poop_type,
                COUNT(DISTINCT r.user_id) as user_count
            FROM records r
            ${where}
            GROUP BY r.poop_type
        `).all(...params);

        const typeStats = {};
        let totalRecords = 0;
        let avgDuration = 0;
        let userCount = 0;
        stats.forEach(s => {
            totalRecords = s.total;
            userCount = s.user_count;
            if (s.avg_duration) avgDuration = Math.round(s.avg_duration);
            if (s.poop_type) typeStats[s.poop_type] = (typeStats[s.poop_type] || 0) + 1;
        });
        // 修正统计：上面的 GROUP BY poop_type 会导致 total/avg_duration 按类型重复，重新查询
        const aggStats = db.prepare(`
            SELECT
                COUNT(*) as total,
                AVG(CASE WHEN r.duration > 0 THEN r.duration END) as avg_duration,
                COUNT(DISTINCT r.user_id) as user_count
            FROM records r
            ${where}
        `).get(...params);

        res.json({
            records: mapped,
            total: aggStats.total,
            avgDuration: Math.round(aggStats.avg_duration || 0),
            userCount: aggStats.user_count,
            page: { limit: lim, offset: off, total: total }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 全局统计信息
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
    try {
        const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        const recordCount = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
        const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;

        // 今日记录
        const today = new Date().toISOString().split('T')[0];
        const todayCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE date LIKE ?').get(today + '%').c;

        // 各类型分布
        const typeDist = db.prepare(`
            SELECT poop_type as id, COUNT(*) as count
            FROM records
            GROUP BY poop_type
        `).all();

        // 近 30 天趋势
        const trendRows = db.prepare(`
            SELECT
                substr(date, 1, 10) as day,
                COUNT(*) as count,
                COUNT(DISTINCT user_id) as users
            FROM records
            WHERE date >= date('now', '-29 days')
            GROUP BY substr(date, 1, 10)
            ORDER BY day DESC
        `).all();

        res.json({
            userCount,
            recordCount,
            adminCount,
            todayCount,
            typeDistribution: typeDist,
            trend: trendRows
        });
    } catch (err) { res.status(500).json({ error: '查询失败' }); }
});

// 删除任意记录
app.delete('/api/admin/record/:id', authenticateToken, requireAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: '删除失败' }); }
});

app.listen(port, () => {
    console.log(`💩 Poop Reminder API listening at http://localhost:${port}`);
    console.log(`📱 Vue Frontend running at http://localhost:${port}`);
    console.log(`🗄️  SQLite database: poopreminder.db`);
});
