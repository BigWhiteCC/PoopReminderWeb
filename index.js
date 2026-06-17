const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function createApp(dbPath = 'poopreminder.db', jwtSecret = process.env.JWT_SECRET || 'poop-reminder-secret-key') {
    const app = express();
    const port = process.env.PORT || 3000;
    const JWT_SECRET = jwtSecret;

    const db = new Database(dbPath);

    const POOP_TYPES = [
        { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球（很难排出）', category: '便秘' },
        { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状', category: '轻微便秘' },
        { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状', category: '正常' },
        { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状', category: '理想' },
        { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状', category: '缺乏纤维' },
        { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状，不成形', category: '轻度腹泻' },
        { id: 7, name: '第7型', emoji: '💧', description: '水状，无固体成分', category: '腹泻' }
    ];

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
        addColumnIfMissing('created_at', 'TEXT');
        addColumnIfMissing('role', 'TEXT DEFAULT \'user\'', 'users');
    }

    initializeDatabase();

    const TEST_EMAIL = 'test@example.com';
    const TEST_USERNAME = 'test';
    const TEST_PASSWORD = 'test123';

    const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    if (IS_DEV && dbPath !== ':memory:') {
        try {
            const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(TEST_EMAIL);
            let testUserId;
            const testPwd = bcrypt.hashSync(TEST_PASSWORD, 10);

            if (byEmail) {
                db.prepare('UPDATE users SET password = ? WHERE id = ?').run(testPwd, byEmail.id);
                testUserId = byEmail.id;
                console.log(`👤 测试账号已就绪: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
            } else {
                const existingTest = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USERNAME);
                if (existingTest) {
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

            const recordCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE user_id = ?').get(testUserId).c;
            if (recordCount === 0) {
                const insRec = db.prepare('INSERT INTO records (user_id, date, notes, poop_type, duration, status) VALUES (?, ?, ?, ?, ?, ?)');
                const types = [3, 4, 4, 5, 4, 3, 2];
                const notes = ['正常', '有点干', '正常', '偏软', '正常', '晨起', '偏稀'];
                const statuses = ['正常', '正常', '顺畅', '正常', '正常', '偏慢', '有点费力'];
                const durations = [300, 420, 240, 480, 300, 600, 360];
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

    function extractDeviceInfo(req) {
        const userAgent = req.headers['user-agent'] || '';
        let deviceType = '未知设备';
        let browser = '未知浏览器';
        let os = '未知系统';
        let model = '';

        if (/Tablet|iPad/i.test(userAgent)) deviceType = '平板';
        else if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) deviceType = '移动设备';
        else deviceType = '桌面电脑';

        if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) browser = 'Chrome';
        else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari';
        else if (/Firefox/i.test(userAgent)) browser = 'Firefox';
        else if (/Edg/i.test(userAgent)) browser = 'Edge';
        else if (/MSIE|Trident/i.test(userAgent)) browser = 'IE';

        if (/Android/i.test(userAgent)) os = 'Android';
        else if (/iPhone|iPad|iPod/i.test(userAgent)) os = 'iOS';
        else if (/Windows NT 10/i.test(userAgent)) os = 'Windows 10/11';
        else if (/Windows/i.test(userAgent)) os = 'Windows';
        else if (/Mac OS X/i.test(userAgent)) os = 'macOS';
        else if (/Linux/i.test(userAgent)) os = 'Linux';

        if (/iPhone/i.test(userAgent)) model = 'iPhone';
        else if (/iPad/i.test(userAgent)) model = 'iPad';
        else if (/iPod/i.test(userAgent)) model = 'iPod';
        else if (/Android/i.test(userAgent)) {
            const brandMatch = userAgent.match(/Pixel\s*\d*[a-z]*/i)
                || userAgent.match(/SM-[A-Z0-9]+/i)
                || userAgent.match(/Mi\s+\d+[a-z]*/i)
                || userAgent.match(/Redmi\s+\w*/i)
                || userAgent.match(/Huawei\s*\w*/i)
                || userAgent.match(/Nexus\s+\d*/i)
                || userAgent.match(/OnePlus\s*\d*[a-z]*/i);
            if (brandMatch) model = brandMatch[0];
        } else if (/Macintosh/i.test(userAgent)) model = 'Mac';
        else if (/Windows/i.test(userAgent)) model = 'Windows PC';

        return {
            type: deviceType, browser, os, model,
            ip: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString(),
            userAgent
        };
    }

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
            const milli = ms ? parseInt(String(ms).slice(0, 3).padStart(3, '0'), 10) : 0;
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

    function getWeekRange(date) {
        const d = date instanceof Date ? new Date(date) : parseDateKey(date);
        if (!d || isNaN(d.getTime())) return null;
        d.setHours(0, 0, 0, 0);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(d);
        monday.setDate(d.getDate() + diff);
        const nextMonday = new Date(monday);
        nextMonday.setDate(monday.getDate() + 7);
        return { start: monday, end: nextMonday };
    }

    function daysBetween(start, end) {
        const days = [];
        const d = new Date(start);
        d.setHours(0, 0, 0, 0);
        const stop = new Date(end);
        stop.setHours(0, 0, 0, 0);
        while (d < stop) {
            days.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }
        return days;
    }

    function getWeekNumber(d) {
        const target = new Date(d.valueOf());
        const dayNr = (d.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }

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

    function computeStats(records) {
        const total = records.length;
        const typeCounts = {};
        let totalDuration = 0;
        let durationCount = 0;
        records.forEach(r => {
            const t = r.poopType || 0;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
            if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
        });
        const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

        const byDay = {};
        records.forEach(r => {
            const key = toDateKey(r.date);
            if (!key) return;
            if (!byDay[key]) byDay[key] = { count: 0, totalDuration: 0, durationN: 0, records: [] };
            byDay[key].count++;
            if (r.duration && r.duration > 0) {
                byDay[key].totalDuration += r.duration;
                byDay[key].durationN++;
            }
            byDay[key].records.push(r);
        });
        const daily = Object.keys(byDay).sort().map(k => ({
            date: k,
            count: byDay[k].count,
            avgDuration: byDay[k].durationN ? Math.round(byDay[k].totalDuration / byDay[k].durationN) : 0
        }));

        const byWeek = {};
        records.forEach(r => {
            const wr = getWeekRange(r.date);
            if (!wr) return;
            const key = `${wr.start.getFullYear()}-W${getWeekNumber(wr.start)}`;
            if (!byWeek[key]) byWeek[key] = { key, start: wr.start.toISOString(), count: 0, totalDuration: 0, durationN: 0 };
            byWeek[key].count++;
            if (r.duration && r.duration > 0) {
                byWeek[key].totalDuration += r.duration;
                byWeek[key].durationN++;
            }
        });
        const weekly = Object.values(byWeek).map(w => ({
            key: w.key, start: w.start, count: w.count,
            avgDuration: w.durationN ? Math.round(w.totalDuration / w.durationN) : 0
        })).sort((a, b) => a.key.localeCompare(b.key));

        return { total, typeCounts, avgDuration, daily, weekly };
    }

    function parseFilterQuery(query) {
        const filter = {};
        if (query.start) {
            const s = parseDateKey(query.start);
            if (s) filter.start = s;
        }
        if (query.end) {
            const e = parseDateKey(query.end);
            if (e) { e.setHours(23, 59, 59, 999); filter.end = e; }
        }
        if (query.poop_type) {
            const pt = parseInt(query.poop_type, 10);
            if (!isNaN(pt) && pt >= 1 && pt <= 7) filter.poopType = pt;
        }
        return filter;
    }

    function formatDurationSec(seconds) {
        const n = Number(seconds);
        if (!n || n <= 0) return '0 秒';
        const s = Math.floor(n);
        if (s < 60) return `${s} 秒`;
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
    }

    app.use(cors());
    app.use(express.json());

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
        } catch (err) { res.status(500).json({ error: '注册失败，请稍后重试' }); }
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
        } catch (err) { res.status(500).json({ error: '登录失败，请稍后重试' }); }
    });

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
        const now = new Date();
        const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);
        const last7 = queryRecords(userId, { start: weekAgo });
        const poopTypeStats = {};
        last7.forEach(r => {
            const key = String(r.poopType || 0);
            poopTypeStats[key] = (poopTypeStats[key] || 0) + 1;
        });
        res.json({
            streak: calculateStreak(userId),
            records,
            last7: { count: last7.length, poopTypeStats }
        });
    });

    app.get('/api/history', authenticateToken, (req, res) => {
        res.json({ records: queryRecords(req.user.userId) });
    });

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

        let recordDate = new Date();
        if (req.body.date) {
            const parsed = parseDateKey(req.body.date);
            if (!parsed) {
                return res.status(400).json({ error: '日期格式无效' });
            }
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            if (parsed.getTime() > endOfToday.getTime()) {
                return res.status(400).json({ error: '日期不能晚于今天' });
            }
            recordDate = parsed;
        }

        try {
            const insertStmt = db.prepare(`
                INSERT INTO records (
                    user_id, date, notes, poop_type, duration, status,
                    device_type, device_browser, device_os, device_model, device_ip, device_user_agent, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = insertStmt.run(
                userId, recordDate.toISOString(), notes, poopType, validDuration, status,
                device.type, device.browser, device.os, device.model, device.ip, device.userAgent,
                new Date().toISOString()
            );
            const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
            res.json({ success: true, record: mapRecord(record) });
        } catch (err) {
            res.status(500).json({ error: '记录失败，请稍后重试' });
        }
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

    app.get('/api/weekly', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const base = parseDateKey(req.query.date) || new Date();
        const { start, end } = getWeekRange(base);
        const filter = parseFilterQuery(req.query);
        const records = queryRecords(userId, {
            start: filter.start || start,
            end: filter.end || end,
            poopType: filter.poopType
        });

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

    app.get('/api/export', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const format = (req.query.format || 'csv').toString().toLowerCase();
        const range = req.query.range || 'month';
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

    app.get('/api/settings', authenticateToken, (req, res) => res.json({ hour: 8, minute: 0 }));
    app.post('/api/settings', authenticateToken, (req, res) => {
        const hour = parseInt(req.body.hour);
        const minute = parseInt(req.body.minute);
        res.json({ success: true, reminderTime: { hour, minute } });
    });

    app.post('/api/user/password', authenticateToken, async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: '新密码至少6位' });
        }
        try {
            const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);
            if (!user) {
                return res.status(404).json({ error: '用户不存在' });
            }
            const valid = await bcrypt.compare(oldPassword, user.password);
            if (!valid) {
                return res.status(400).json({ error: '旧密码错误' });
            }
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.userId);
            res.json({ success: true, message: '密码修改成功' });
        } catch (err) {
            res.status(500).json({ error: '修改密码失败' });
        }
    });

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

            const total = db.prepare(`SELECT COUNT(*) as c FROM records r ${where}`).get(...params).c;

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

    app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
        try {
            const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
            const recordCount = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
            const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;

            const today = new Date().toISOString().split('T')[0];
            const todayCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE date LIKE ?').get(today + '%').c;

            const typeDist = db.prepare(`
                SELECT poop_type as id, COUNT(*) as count
                FROM records
                GROUP BY poop_type
            `).all();

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

    app.delete('/api/admin/record/:id', authenticateToken, requireAdmin, (req, res) => {
        try {
            db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: '删除失败' }); }
    });

    app.post('/api/admin/user/:id/password', authenticateToken, requireAdmin, async (req, res) => {
        const userId = parseInt(req.params.id);
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: '新密码至少6位' });
        }

        try {
            const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
            if (!user) {
                return res.status(404).json({ error: '用户不存在' });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);

            res.json({ success: true, message: `用户 ${user.username} 的密码已重置` });
        } catch (err) {
            res.status(500).json({ error: '重置密码失败' });
        }
    });

    app.delete('/api/admin/user/:id', authenticateToken, requireAdmin, async (req, res) => {
        const userId = parseInt(req.params.id);

        try {
            const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
            if (!user) {
                return res.status(404).json({ error: '用户不存在' });
            }

            if (userId === req.user.userId) {
                return res.status(400).json({ error: '不能删除自己' });
            }

            if (user.role === 'admin') {
                return res.status(400).json({ error: '不能删除管理员账号' });
            }

            db.prepare('DELETE FROM records WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM users WHERE id = ?').run(userId);

            res.json({ success: true, message: `用户 ${user.username} 已删除` });
        } catch (err) {
            res.status(500).json({ error: '删除用户失败' });
        }
    });

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
        const relPath = req.path.substring(1);
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

    return {
        app,
        db,
        POOP_TYPES,
        toDateKey,
        parseDateKey,
        calculateStreak,
        getWeekRange,
        daysBetween,
        queryRecords,
        computeStats,
        getWeekNumber,
        parseFilterQuery,
        extractDeviceInfo,
        authenticateToken,
        requireAdmin,
        mapRecord,
        formatDurationSec,
        start: () => {
            try {
                app.listen(port, () => {
                    console.log(`💩 Poop Reminder API listening at http://localhost:${port}`);
                    console.log(`📱 Vue Frontend running at http://localhost:${port}`);
                    console.log(`🗄️  SQLite database: ${dbPath}`);
                }).on('error', (err) => {
                    console.error('❌ Failed to start server:', err.message);
                    process.exit(1);
                });
            } catch (err) {
                console.error('❌ Failed to start server (sync):', err.message);
                process.exit(1);
            }
        }
    };
}

if (require.main === module) {
    const { start } = createApp();
    start();
}

module.exports = { createApp };
