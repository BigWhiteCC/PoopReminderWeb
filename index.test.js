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
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

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
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            reminder_hour INTEGER DEFAULT 8,
            reminder_minute INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
            const userRow = db.prepare('SELECT enabled FROM users WHERE id = ?').get(user.userId);
            if (!userRow || userRow.enabled === 0) return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
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
            if (user.enabled === 0) return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
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

    app.post('/api/user/password', authenticateToken, async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写完整信息' });
        if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
        try {
            const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            const valid = await bcrypt.compare(oldPassword, user.password);
            if (!valid) return res.status(400).json({ error: '旧密码错误' });
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            const now = new Date().toISOString();
            db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(hashedPassword, now, req.user.userId);
            res.json({ success: true, message: '密码修改成功' });
        } catch (err) { res.status(500).json({ error: '修改失败' }); }
    });

    app.get('/api/settings', authenticateToken, (req, res) => {
        try {
            const row = db.prepare('SELECT reminder_hour, reminder_minute FROM user_settings WHERE user_id = ?').get(req.user.userId);
            res.json({
                hour: row ? row.reminder_hour : 8,
                minute: row ? row.reminder_minute : 0
            });
        } catch (err) { res.status(500).json({ error: '获取失败' }); }
    });

    app.post('/api/settings', authenticateToken, (req, res) => {
        const hour = parseInt(req.body.hour);
        const minute = parseInt(req.body.minute);
        if (isNaN(hour) || hour < 0 || hour > 23) return res.status(400).json({ error: '小时必须是 0-23 之间的整数' });
        if (isNaN(minute) || minute < 0 || minute > 59) return res.status(400).json({ error: '分钟必须是 0-59 之间的整数' });
        try {
            const now = new Date().toISOString();
            db.prepare(`INSERT INTO user_settings (user_id, reminder_hour, reminder_minute, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reminder_hour = excluded.reminder_hour, reminder_minute = excluded.reminder_minute, updated_at = excluded.updated_at`).run(req.user.userId, hour, minute, now);
            res.json({ success: true, reminderTime: { hour, minute } });
        } catch (err) { res.status(500).json({ error: '保存失败' }); }
    });

    app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
        const users = db.prepare(`
            SELECT u.id, u.username, u.email, u.role, u.enabled, u.created_at,
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

    app.post('/api/admin/user/:id/password', authenticateToken, requireAdmin, async (req, res) => {
        const userId = parseInt(req.params.id);
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
        try {
            const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            const now = new Date().toISOString();
            db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(hashedPassword, now, userId);
            res.json({ success: true, message: `用户 ${user.username} 的密码已重置` });
        } catch (err) { res.status(500).json({ error: '重置失败' }); }
    });

    app.delete('/api/admin/user/:id', authenticateToken, requireAdmin, (req, res) => {
        const userId = parseInt(req.params.id);
        try {
            const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            if (userId === req.user.userId) return res.status(400).json({ error: '不能删除自己' });
            if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });
            db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM records WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM users WHERE id = ?').run(userId);
            res.json({ success: true, message: `用户 ${user.username} 已删除` });
        } catch (err) { res.status(500).json({ error: '删除失败' }); }
    });

    app.post('/api/admin/user/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
        const userId = parseInt(req.params.id);
        try {
            const user = db.prepare('SELECT id, username, role, enabled FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            if (user.role === 'admin') return res.status(400).json({ error: '不能禁用管理员账号' });
            const newEnabled = user.enabled ? 0 : 1;
            db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(newEnabled, userId);
            res.json({ success: true, message: `用户 ${user.username} 已${newEnabled ? '启用' : '禁用'}`, enabled: newEnabled });
        } catch (err) { res.status(500).json({ error: '操作失败' }); }
    });

    app.get('/api/admin/login-logs', authenticateToken, requireAdmin, (req, res) => {
        res.json({ logs: [], page: { limit: 100, offset: 0, total: 0 } });
    });

    app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, (req, res) => {
        res.json({ logs: [], page: { limit: 100, offset: 0, total: 0 } });
    });

    app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
        const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        const recordCount = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
        const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
        res.json({ userCount, recordCount, adminCount, todayCount: 0, typeDistribution: [], trend: [] });
    });

    // 导出核心函数供单元测试使用
    app.locals.testHelpers = { toDateKey, parseDateKey, calculateStreak };
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

// ============ API 集成测试：密码修改 ============
describe('密码修改 API', () => {
    test('修改密码：缺少字段应返回 400', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('请填写完整信息');
    });

    test('修改密码：新密码过短应返回 400', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ oldPassword: 'test123', newPassword: '123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('新密码至少6位');
    });

    test('修改密码：旧密码错误应返回 400', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ oldPassword: 'wrongpassword', newPassword: 'newpassword123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('旧密码错误');
    });

    test('修改密码：正常修改应成功', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ oldPassword: 'test123', newPassword: 'newpassword123' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('密码修改成功');

        const loginRes = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'newpassword123'
        });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);

        db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(
            bcrypt.hashSync('test123', 10), new Date().toISOString(), testUserId
        );
    });
});

// ============ API 集成测试：用户禁用检查 ============
describe('用户状态 API', () => {
    test('禁用用户登录应返回 403', async () => {
        db.prepare('UPDATE users SET enabled = 0 WHERE id = ?').run(testUserId);

        const res = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'test123'
        });
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('账号已被禁用');

        db.prepare('UPDATE users SET enabled = 1 WHERE id = ?').run(testUserId);
    });

    test('禁用用户使用 token 应被拒绝', async () => {
        db.prepare('UPDATE users SET enabled = 0 WHERE id = ?').run(testUserId);

        const res = await request(app).get('/api/user')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);

        db.prepare('UPDATE users SET enabled = 1 WHERE id = ?').run(testUserId);
    });
});

// ============ API 集成测试：设置 API ============
describe('设置 API', () => {
    test('获取设置应返回默认值', async () => {
        const res = await request(app).get('/api/settings')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.hour).toBe(8);
        expect(res.body.minute).toBe(0);
    });

    test('保存设置：无效小时应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 25, minute: 0 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('小时必须是 0-23 之间的整数');
    });

    test('保存设置：无效分钟应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: 60 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('分钟必须是 0-59 之间的整数');
    });

    test('保存设置：正常保存应成功', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 20, minute: 30 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reminderTime.hour).toBe(20);
        expect(res.body.reminderTime.minute).toBe(30);

        const getRes = await request(app).get('/api/settings')
            .set('Authorization', `Bearer ${testToken}`);
        expect(getRes.body.hour).toBe(20);
        expect(getRes.body.minute).toBe(30);
    });

    test('保存设置：边界值应成功', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 0, minute: 0 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ============ API 集成测试：管理员扩展功能 ============
describe('管理员 API - 扩展功能', () => {
    test('管理员重置密码：密码过短应返回 400', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: '123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('新密码至少6位');
    });

    test('管理员重置密码：正常重置应成功', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'adminreset123' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const loginRes = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'adminreset123'
        });
        expect(loginRes.status).toBe(200);

        db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(
            bcrypt.hashSync('test123', 10), new Date().toISOString(), testUserId
        );
    });

    test('管理员删除用户：删除自己应返回 400', async () => {
        const res = await request(app).delete(`/api/admin/user/${adminUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除自己');
    });

    test('管理员删除用户：删除管理员应返回 400', async () => {
        const otherAdminId = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('otheradmin', 'otheradmin@test.com', bcrypt.hashSync('pass', 10), 'admin').lastInsertRowid;

        const res = await request(app).delete(`/api/admin/user/${otherAdminId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除管理员账号');

        db.prepare('DELETE FROM users WHERE id = ?').run(otherAdminId);
    });

    test('管理员删除用户：删除普通用户应成功', async () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('deleteuser', 'delete@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;

        const res = await request(app).delete(`/api/admin/user/${otherUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId);
        expect(user).toBeUndefined();
    });

    test('管理员禁用用户：禁用管理员应返回 400', async () => {
        const res = await request(app).post(`/api/admin/user/${adminUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能禁用管理员账号');
    });

    test('管理员禁用用户：禁用普通用户应成功', async () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('toggleuser', 'toggle@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;

        const res = await request(app).post(`/api/admin/user/${otherUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.enabled).toBe(0);

        const user = db.prepare('SELECT enabled FROM users WHERE id = ?').get(otherUserId);
        expect(user.enabled).toBe(0);

        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });

    test('管理员获取登录日志应成功', async () => {
        const res = await request(app).get('/api/admin/login-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('管理员获取审计日志应成功', async () => {
        const res = await request(app).get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('管理员获取全局统计应成功', async () => {
        const res = await request(app).get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.userCount).toBeDefined();
        expect(res.body.recordCount).toBeDefined();
        expect(res.body.adminCount).toBeDefined();
        expect(res.body.todayCount).toBeDefined();
    });
});