/**
 * 后端核心逻辑与API集成测试
 * 重点覆盖：日期解析、连续打卡计算、认证、记录CRUD、权限校验
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

// 测试数据库路径
const TEST_DB_PATH = ':memory:';
const JWT_SECRET = 'test-secret-key';

// 创建测试用的 express 应用
let app;
let db;
let testUserId;
let adminUserId;
let testToken;
let adminToken;

// 在测试前初始化
beforeAll(() => {
    // 创建内存数据库
    db = new Database(TEST_DB_PATH);
    
    // 初始化表结构
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

    // 创建测试用户
    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

    // 创建管理员用户
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const adminResult = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', adminPassword, 'admin');
    adminUserId = adminResult.lastInsertRowid;
    adminToken = jwt.sign({ userId: adminUserId, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });

    // 创建 express 应用（简化版，只包含测试需要的路由）
    const express = require('express');
    const cors = require('cors');
    app = express();
    app.use(cors());
    app.use(express.json());

    // 复制核心逻辑函数
    const POOP_TYPES = [
        { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球', category: '便秘' },
        { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状', category: '轻微便秘' },
        { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状', category: '正常' },
        { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状', category: '理想' },
        { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状', category: '缺乏纤维' },
        { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状', category: '轻度腹泻' },
        { id: 7, name: '第7型', emoji: '💧', description: '水状', category: '腹泻' }
    ];

    // 日期解析函数（从 index.js 复制）
    function toDateKey(dateStr) {
        if (!dateStr) return null;
        const s = String(dateStr).trim();
        const pure = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (pure) return `${pure[1]}-${pure[2]}-${pure[3]}`;
        const withTime = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
        if (withTime) {
            const [, y, mo, d, h, mi, se, ms, tz] = withTime;
            if (!tz) return `${y}-${mo}-${d}`;
            const dt = new Date(Date.UTC(
                parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
                parseInt(h, 10), parseInt(mi, 10),
                se ? parseInt(se, 10) : 0,
                ms ? parseInt(String(ms).slice(0, 3).padEnd(3, '0'), 10) : 0
            ));
            if (isNaN(dt.getTime())) return `${y}-${mo}-${d}`;
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
        const d = new Date(s);
        if (isNaN(d.getTime())) {
            const fallback = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            return fallback ? `${fallback[1]}-${fallback[2]}-${fallback[3]}` : null;
        }
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function parseDateKey(dateStr) {
        if (!dateStr) return null;
        const s = String(dateStr).trim();
        const full = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
        if (full) {
            const [, y, mo, d, h, mi, se, ms, tz] = full;
            const year = parseInt(y, 10);
            const month = parseInt(mo, 10) - 1;
            const day = parseInt(d, 10);
            const hour = parseInt(h, 10);
            const minute = parseInt(mi, 10);
            const second = se ? parseInt(se, 10) : 0;
            const milli = ms ? parseInt(String(ms).slice(0, 3).padEnd(3, '0'), 10) : 0;
            if (tz && tz.toUpperCase() === 'Z') {
                const dt = new Date(Date.UTC(year, month, day, hour, minute, second, milli));
                return isNaN(dt.getTime()) ? null : dt;
            }
            if (tz) {
                const sign = tz[0] === '-' ? -1 : 1;
                const body = tz.replace(/[+-:]/g, '');
                const oh = parseInt(body.slice(0, 2), 10) || 0;
                const om = parseInt(body.slice(2, 4), 10) || 0;
                const offsetMs = sign * (oh * 60 + om) * 60 * 1000;
                const dt = new Date(Date.UTC(year, month, day, hour, minute, second, milli) - offsetMs);
                return isNaN(dt.getTime()) ? null : dt;
            }
            const dt = new Date(year, month, day, hour, minute, second, milli);
            return isNaN(dt.getTime()) ? null : dt;
        }
        const dOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dOnly) {
            const dt = new Date(parseInt(dOnly[1], 10), parseInt(dOnly[2], 10) - 1, parseInt(dOnly[3], 10));
            return isNaN(dt.getTime()) ? null : dt;
        }
        const dt = new Date(s);
        return isNaN(dt.getTime()) ? null : dt;
    }

    // 连续打卡计算
    function calculateStreak(userId) {
        const records = db.prepare("SELECT date FROM records WHERE user_id = ? ORDER BY date DESC").all(userId);
        if (records.length === 0) return 0;
        const days = new Set(records.map(r => toDateKey(r.date)).filter(Boolean));
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 3650; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (days.has(key)) streak++;
            else break;
        }
        return streak;
    }

    // 认证中间件
    function authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: 'Invalid token' });
            req.user = user;
            next();
        });
    }

    function requireAdmin(req, res, next) {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: '需要管理员权限' });
        }
        next();
    }

    function mapRecord(r) {
        return {
            id: r.id,
            userId: r.user_id,
            date: r.date,
            notes: r.notes,
            poopType: r.poop_type,
            duration: r.duration || 0,
            status: r.status,
            device: {
                type: r.device_type, browser: r.device_browser, os: r.device_os,
                model: r.device_model, ip: r.device_ip, userAgent: r.device_user_agent
            }
        };
    }

    // API 路由
    app.get('/api/poop-types', (req, res) => res.json({ types: POOP_TYPES }));

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
        } catch (err) { res.status(500).json({ error: '注册失败' }); }
    });

    app.post('/api/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: '请输入账号和密码' });
        try {
            const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
            if (!user) return res.status(401).json({ error: '账号或密码错误' });
            const valid = await bcrypt.compare(password, user.password);
            if (!valid) return res.status(401).json({ error: '账号或密码错误' });
            const role = user.role || 'user';
            const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, role } });
        } catch (err) { res.status(500).json({ error: '登录失败' }); }
    });

    app.get('/api/user', authenticateToken, (req, res) => {
        const user = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        res.json(user);
    });

    app.get('/api/home', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC LIMIT 5').all(userId).map(mapRecord);
        res.json({ streak: calculateStreak(userId), records });
    });

    app.post('/api/record', authenticateToken, (req, res) => {
        const userId = req.user.userId;
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
        let recordDate = new Date();
        if (req.body.date) {
            const parsed = parseDateKey(req.body.date);
            if (!parsed) return res.status(400).json({ error: '日期格式无效' });
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            if (parsed.getTime() > endOfToday.getTime()) {
                return res.status(400).json({ error: '日期不能晚于今天' });
            }
            recordDate = parsed;
        }
        try {
            const result = db.prepare(`
                INSERT INTO records (user_id, date, notes, poop_type, duration, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(userId, recordDate.toISOString(), notes, poopType, validDuration, status, new Date().toISOString());
            const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
            res.json({ success: true, record: mapRecord(record) });
        } catch (err) { res.status(500).json({ error: '记录失败' }); }
    });

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
            db.prepare('UPDATE records SET notes=?, poop_type=?, duration=?, status=? WHERE id=? AND user_id=?').run(notes, poopType, duration, status, id, userId);
            const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
            res.json({ success: true, record: mapRecord(updated) });
        } catch (err) { res.status(500).json({ error: '更新失败' }); }
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
        } catch (err) { res.status(500).json({ error: '删除失败' }); }
    });

    app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
        const users = db.prepare(`
            SELECT u.id, u.username, u.email, u.role, u.created_at,
                   COUNT(r.id) as record_count
            FROM users u
            LEFT JOIN records r ON r.user_id = u.id
            GROUP BY u.id
            ORDER BY u.id DESC
        `).all();
        res.json({ users });
    });

    app.delete('/api/admin/record/:id', authenticateToken, requireAdmin, (req, res) => {
        try {
            db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: '删除失败' }); }
    });

    // 导出核心函数供单元测试使用
    app.locals.testHelpers = { toDateKey, parseDateKey, calculateStreak };

    // 周视图路由
    app.get('/api/weekly', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const base = parseDateKey(req.query.date) || new Date();
        const day = base.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(base);
        monday.setDate(base.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        const nextMonday = new Date(monday);
        nextMonday.setDate(monday.getDate() + 7);

        const days = [];
        const d = new Date(monday);
        while (d < nextMonday) {
            days.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }

        const byDay = {};
        days.forEach(day => {
            const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
            byDay[key] = { date: key, items: [], count: 0, totalDuration: 0, typeCounts: {} };
        });

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(userId);
        records.forEach(r => {
            const key = toDateKey(r.date);
            if (key && byDay[key]) {
                byDay[key].items.push(r);
                byDay[key].count++;
                if (r.duration && r.duration > 0) byDay[key].totalDuration += r.duration;
                byDay[key].typeCounts[r.poop_type || 0] = (byDay[key].typeCounts[r.poop_type || 0] || 0) + 1;
            }
        });

        const dailyList = Object.values(byDay).map(d => ({
            date: d.date, count: d.count,
            avgDuration: d.count ? Math.round(d.totalDuration / d.count) : 0,
            typeCounts: d.typeCounts
        }));

        let totalCount = 0, totalDuration = 0;
        const typeStats = {};
        dailyList.forEach(d => {
            totalCount += d.count;
            totalDuration += d.count * d.avgDuration;
            Object.keys(d.typeCounts).forEach(t => {
                typeStats[t] = (typeStats[t] || 0) + d.typeCounts[t];
            });
        });

        res.json({
            range: { start: monday.toISOString(), end: nextMonday.toISOString() },
            weekLabel: `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日 - ${nextMonday.getMonth() + 1}月${nextMonday.getDate()}日`,
            days: dailyList,
            summary: {
                totalCount,
                avgDuration: totalCount ? Math.round(totalDuration / totalCount) : 0,
                avgPerDay: Math.round((totalCount / 7) * 10) / 10,
                typeStats
            },
            records: records.map(mapRecord)
        });
    });

    // 月视图路由
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

        const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const byDay = {};
        for (let i = 1; i <= daysInMonth; i++) {
            const key = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            byDay[key] = { date: key, count: 0, totalDuration: 0, typeCounts: {} };
        }

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(userId);
        records.forEach(r => {
            const key = toDateKey(r.date);
            if (key && byDay[key]) {
                byDay[key].count++;
                if (r.duration && r.duration > 0) byDay[key].totalDuration += r.duration;
                byDay[key].typeCounts[r.poop_type || 0] = (byDay[key].typeCounts[r.poop_type || 0] || 0) + 1;
            }
        });

        const dailyList = Object.values(byDay).map(d => ({
            date: d.date, count: d.count,
            avgDuration: d.count ? Math.round(d.totalDuration / d.count) : 0,
            typeCounts: d.typeCounts
        }));

        const weekBuckets = [];
        let currentWeekStart = new Date(start);
        while (currentWeekStart < end) {
            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(currentWeekStart.getDate() + 7);
            const realEnd = weekEnd < end ? weekEnd : end;
            weekBuckets.push({
                start: currentWeekStart.toISOString(),
                end: realEnd.toISOString(),
                label: `${currentWeekStart.getMonth() + 1}/${String(currentWeekStart.getDate()).padStart(2, '0')} - ${realEnd.getMonth() + 1}/${String(realEnd.getDate()).padStart(2, '0')}`,
                count: 0,
                avgDuration: 0,
                typeStats: {}
            });
            currentWeekStart = weekEnd;
        }

        let currentCount = 0, totalDuration = 0;
        const typeStats = {};
        dailyList.forEach(d => {
            currentCount += d.count;
            totalDuration += d.count * d.avgDuration;
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
                count: 0,
                diff: 0
            },
            records: records.map(mapRecord)
        });
    });

    // 列表路由
    app.get('/api/list', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        let sql = 'SELECT * FROM records WHERE user_id = ?';
        const params = [userId];

        if (req.query.poop_type) {
            const pt = parseInt(req.query.poop_type, 10);
            if (!isNaN(pt) && pt >= 1 && pt <= 7) {
                sql += ' AND poop_type = ?';
                params.push(pt);
            }
        }

        if (req.query.start) {
            const parsed = parseDateKey(req.query.start);
            if (parsed) {
                const startKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
                sql += " AND date(date, 'localtime') >= ?";
                params.push(startKey);
            }
        }

        sql += ' ORDER BY date DESC';
        const records = db.prepare(sql).all(...params).map(mapRecord);
        res.json({ records, stats: { total: records.length }, filter: {} });
    });

    // 导出路由
    app.get('/api/export', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const format = (req.query.format || 'csv').toLowerCase();
        const range = req.query.range || 'month';

        const now = new Date();
        let fileName = `monthly_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (range === 'week') {
            fileName = `weekly_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        } else if (range === 'all') {
            fileName = 'all_records';
        }

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(userId);

        if (format === 'txt') {
            const lines = [`拉屎记录导出 - ${new Date().toLocaleString('zh-CN')}`, `共 ${records.length} 条记录`, ''];
            records.forEach((r, i) => {
                const d = new Date(r.date);
                lines.push(`${i + 1}. ${d.toLocaleString('zh-CN')}`);
                lines.push(`   类型: ${r.poop_type || '未记录'}`);
                lines.push(`   时长: ${r.duration ? `${r.duration} 秒` : '未记录'}`);
                lines.push('');
            });
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
            res.send('\uFEFF' + lines.join('\n'));
            return;
        }

        const rows = [['日期', '时间', '类型编号', '持续时长(秒)']];
        records.forEach(r => {
            const d = new Date(r.date);
            rows.push([
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
                r.poop_type || '',
                r.duration || 0
            ]);
        });
        const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.csv"`);
        res.send(csv);
    });
});

afterAll(() => {
    db.close();
});

// ============ 单元测试：日期解析函数 ============
describe('toDateKey - 日期解析与时区处理', () => {
    let toDateKey;

    beforeAll(() => {
        toDateKey = app.locals.testHelpers.toDateKey;
    });

    test('纯日期格式 YYYY-MM-DD 应正确解析', () => {
        expect(toDateKey('2024-01-15')).toBe('2024-01-15');
        expect(toDateKey('2024-12-31')).toBe('2024-12-31');
    });

    test('带时间的 ISO 字符串（无时区）应取本地日期', () => {
        expect(toDateKey('2024-01-15T08:30:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
    });

    test('带 Z 时区的 UTC 时间应转换为本地日期', () => {
        // UTC 00:00 在东八区是早上 8:00，日期相同
        expect(toDateKey('2024-01-15T00:00:00Z')).toBe('2024-01-15');
        // UTC 16:00 在东八区是凌晨 00:00（次日），但取决于测试环境时区
        const result = toDateKey('2024-01-15T16:00:00Z');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('带时区偏移的 ISO 字符串应正确转换', () => {
        expect(toDateKey('2024-01-15T08:00:00+08:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T00:00:00-08:00')).toBe('2024-01-15');
    });

    test('空值和无效输入应返回 null', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toDateKey(undefined)).toBeNull();
        expect(toDateKey('')).toBeNull();
        expect(toDateKey('invalid')).toBeNull();
    });

    test('边界情况：跨日期的时间点', () => {
        // 23:59:59 仍属于当天
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
        // 00:00:00 属于当天（本地时间）
        expect(toDateKey('2024-01-16T00:00:00')).toBe('2024-01-16');
    });
});

describe('parseDateKey - 完整日期解析', () => {
    let parseDateKey;

    beforeAll(() => {
        parseDateKey = app.locals.testHelpers.parseDateKey;
    });

    test('纯日期应解析为本地 00:00:00', () => {
        const d = parseDateKey('2024-01-15');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0); // January
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    test('带时间的 ISO 字符串应正确解析', () => {
        const d = parseDateKey('2024-01-15T14:30:00');
        expect(d).not.toBeNull();
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(30);
    });

    test('带 Z 时区应转换为本地时间', () => {
        const d = parseDateKey('2024-01-15T08:00:00Z');
        expect(d).not.toBeNull();
        // UTC 08:00 转换为本地时间，具体小时取决于测试环境时区
        // 验证日期部分正确即可
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('带时区偏移应正确转换', () => {
        const d = parseDateKey('2024-01-15T08:00:00+08:00');
        expect(d).not.toBeNull();
        // +08:00 的 08:00 等于 UTC 00:00，本地时间取决于时区
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('无效日期应返回 null', () => {
        expect(parseDateKey(null)).toBeNull();
        expect(parseDateKey('invalid')).toBeNull();
        // JavaScript Date 会自动调整无效月份，所以这里测试明显无效的格式
        expect(parseDateKey('not-a-date')).toBeNull();
    });
});

// ============ 单元测试：连续打卡计算 ============
describe('calculateStreak - 连续打卡天数', () => {
    let calculateStreak;

    beforeAll(() => {
        calculateStreak = app.locals.testHelpers.calculateStreak;
    });

    test('无记录时应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录时应返回 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(1);
        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('连续 7 天打卡应返回 7', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }
        expect(calculateStreak(testUserId)).toBe(7);
        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('中断打卡应返回中断前的天数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // 今天和昨天有记录，但前天没有
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(2);
        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(0);
        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

// ============ API 集成测试：认证 ============
describe('认证 API', () => {
    test('注册：缺少必填字段应返回 400', async () => {
        const res = await request(app).post('/api/register').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能为空');
    });

    test('注册：正常注册应成功', async () => {
        const res = await request(app).post('/api/register').send({
            username: 'newuser',
            email: 'new@test.com',
            password: 'password123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
        expect(res.body.user.username).toBe('newuser');
    });

    test('注册：重复邮箱应返回 400', async () => {
        const res = await request(app).post('/api/register').send({
            username: 'another',
            email: 'test@test.com', // 已存在的邮箱
            password: 'password123'
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('已被注册');
    });

    test('登录：缺少字段应返回 400', async () => {
        const res = await request(app).post('/api/login').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('请输入');
    });

    test('登录：错误密码应返回 401', async () => {
        const res = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'wrongpassword'
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('账号或密码错误');
    });

    test('登录：正确凭据应成功', async () => {
        const res = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'test123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
    });

    test('登录：支持用户名登录', async () => {
        const res = await request(app).post('/api/login').send({
            email: 'testuser', // 使用用户名而非邮箱
            password: 'test123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('认证中间件', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/user');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    test('无效 token 应返回 403', async () => {
        const res = await request(app).get('/api/user').set('Authorization', 'Bearer invalidtoken');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Invalid token');
    });

    test('有效 token 应成功获取用户信息', async () => {
        const res = await request(app).get('/api/user').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('testuser');
        expect(res.body.email).toBe('test@test.com');
    });
});

// ============ API 集成测试：记录 CRUD ============
describe('记录 API - 数据校验', () => {
    test('创建记录：缺少大便类型应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('请先选择大便类型');
    });

    test('创建记录：无效类型值应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 8 }); // 超出范围
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('1-7型');
    });

    test('创建记录：类型为 0 应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 0 });
        expect(res.status).toBe(400);
    });

    test('创建记录：正常创建应成功', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, duration: 300, notes: '测试备注', status: '正常' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.record.poopType).toBe(4);
        expect(res.body.record.duration).toBe(300);
        expect(res.body.record.notes).toBe('测试备注');
    });

    test('创建记录：未来日期应返回 400', async () => {
        const future = new Date();
        future.setDate(future.getDate() + 1);
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, date: future.toISOString() });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能晚于今天');
    });

    test('创建记录：无效日期格式应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, date: 'invalid-date' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('日期格式无效');
    });

    test('创建记录：超长时长应被截断为 0', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, duration: 999999 }); // 超过 24 小时
        expect(res.status).toBe(200);
        expect(res.body.record.duration).toBe(0);
    });
});

describe('记录 API - 权限校验', () => {
    let recordId;

    beforeEach(() => {
        // 创建一条测试记录
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        recordId = result.lastInsertRowid;
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
    });

    test('更新记录：非本人记录应返回 404', async () => {
        // 创建另一用户的记录
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other', 'other@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        const otherRecordId = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, new Date().toISOString(), 4, new Date().toISOString()
        ).lastInsertRowid;

        const res = await request(app).put(`/api/record/${otherRecordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 5 });
        expect(res.status).toBe(404);

        // 清理
        db.prepare('DELETE FROM records WHERE id = ?').run(otherRecordId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });

    test('删除记录：非本人记录应返回 403', async () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other2', 'other2@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        const otherRecordId = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, new Date().toISOString(), 4, new Date().toISOString()
        ).lastInsertRowid;

        const res = await request(app).delete(`/api/delete/${otherRecordId}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);

        // 清理
        db.prepare('DELETE FROM records WHERE id = ?').run(otherRecordId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });

    test('删除记录：本人记录应成功', async () => {
        const res = await request(app).delete(`/api/delete/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ============ API 集成测试：管理员权限 ============
describe('管理员 API - 权限校验', () => {
    test('普通用户访问管理员接口应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('管理员权限');
    });

    test('管理员访问用户列表应成功', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
        expect(res.body.users.length).toBeGreaterThan(0);
    });

    test('管理员删除任意记录应成功', async () => {
        // 创建一条普通用户的记录
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        const recordId = result.lastInsertRowid;

        const res = await request(app).delete(`/api/admin/record/${recordId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // 验证已删除
        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
        expect(record).toBeUndefined();
    });

    test('无认证访问管理员接口应返回 401', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });
});

// ============ API 集成测试：公共接口 ============
describe('公共 API', () => {
    test('获取大便类型列表应成功', async () => {
        const res = await request(app).get('/api/poop-types');
        expect(res.status).toBe(200);
        expect(res.body.types).toBeDefined();
        expect(res.body.types.length).toBe(7);
        expect(res.body.types[0].id).toBe(1);
        expect(res.body.types[6].id).toBe(7);
    });
});

// ============ API 集成测试：首页数据 ============
describe('首页 API', () => {
    test('获取首页数据应包含连续打卡信息', async () => {
        // 创建今天的记录
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );

        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.streak).toBeDefined();
        expect(res.body.streak).toBeGreaterThanOrEqual(1);
        expect(res.body.records).toBeDefined();

        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

// ============ API 集成测试：周视图 ============
describe('周视图 API', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/weekly');
        expect(res.status).toBe(401);
    });

    test('获取周视图数据应成功', async () => {
        const today = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300 + i * 60
            );
        }

        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
        expect(res.body.days).toBeDefined();
        expect(res.body.days.length).toBe(7);
        expect(res.body.summary).toBeDefined();
        expect(res.body.summary.totalCount).toBe(3);

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('指定日期应返回对应周数据', async () => {
        const res = await request(app).get('/api/weekly?date=2024-01-15')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
    });

    test('无效日期应使用当前日期', async () => {
        const res = await request(app).get('/api/weekly?date=invalid')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
    });
});

// ============ API 集成测试：月视图 ============
describe('月视图 API', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/monthly');
        expect(res.status).toBe(401);
    });

    test('获取月视图数据应成功', async () => {
        const today = new Date();
        for (let i = 0; i < 5; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), (i % 7) + 1, 300
            );
        }

        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBeDefined();
        expect(res.body.range).toBeDefined();
        expect(res.body.days).toBeDefined();
        expect(res.body.summary).toBeDefined();
        expect(res.body.weeks).toBeDefined();

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('指定月份应返回对应月数据', async () => {
        const res = await request(app).get('/api/monthly?date=2024-01')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBe('2024-01');
    });

    test('无效月份应使用当前月份', async () => {
        const res = await request(app).get('/api/monthly?date=invalid')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBeDefined();
    });

    test('应包含上月对比数据', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.compareWithLastMonth).toBeDefined();
        expect(res.body.compareWithLastMonth.count).toBeDefined();
    });
});

// ============ API 集成测试：记录列表筛选 ============
describe('记录列表 API', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/list');
        expect(res.status).toBe(401);
    });

    test('获取记录列表应成功', async () => {
        const today = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300
            );
        }

        const res = await request(app).get('/api/list')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.stats).toBeDefined();
        expect(res.body.filter).toBeDefined();

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('按类型筛选应正确过滤', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 1, 300
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300
        );

        const res = await request(app).get('/api/list?poop_type=1')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        res.body.records.forEach(r => expect(r.poopType).toBe(1));

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('按日期范围筛选应正确过滤', async () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const twoDaysAgo = new Date(today);
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(
            testUserId, twoDaysAgo.toISOString(), 4
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(
            testUserId, today.toISOString(), 4
        );

        const res = await request(app).get(`/api/list?start=${yesterday.toISOString().split('T')[0]}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(2);

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

// ============ API 集成测试：导出功能 ============
describe('导出 API', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/export');
        expect(res.status).toBe(401);
    });

    test('导出 CSV 格式应成功', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, '测试备注'
        );

        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('.csv');
        expect(res.text).toContain('日期');
        expect(res.text).toContain('类型编号');

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('导出 TXT 格式应成功', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, '测试备注'
        );

        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.headers['content-disposition']).toContain('.txt');
        expect(res.text).toContain('拉屎记录导出');
        expect(res.text).toContain('共 1 条记录');

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('导出周数据应成功', async () => {
        const res = await request(app).get('/api/export?range=week')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('weekly_');
    });

    test('导出全部数据应成功', async () => {
        const res = await request(app).get('/api/export?range=all')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('all_records');
    });

    test('默认导出月度数据应成功', async () => {
        const res = await request(app).get('/api/export')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('monthly_');
    });
});