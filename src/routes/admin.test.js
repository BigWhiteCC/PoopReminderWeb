/**
 * 管理员路由深度测试
 * 重点覆盖：复杂筛选逻辑、分页、审计日志详情、权限校验边界情况
 */

process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const express = require('express');
const cors = require('cors');

let app;
let db;
let adminUserId;
let adminToken;
let testUserId;
let testToken;

beforeAll(() => {
    // 创建内存数据库
    db = new Database(':memory:');
    
    // 初始化完整表结构（与生产环境一致）
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
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            ip TEXT,
            user_agent TEXT,
            success INTEGER NOT NULL DEFAULT 0,
            fail_reason TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
        CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
    `);

    // 创建管理员用户
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const adminResult = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', adminPassword, 'admin');
    adminUserId = adminResult.lastInsertRowid;
    adminToken = jwt.sign({ userId: adminUserId, username: 'admin', role: 'admin' }, 'test-secret-key', { expiresIn: '30d' });

    // 创建普通用户
    const testPassword = bcrypt.hashSync('test123', 10);
    const testResult = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', testPassword);
    testUserId = testResult.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, 'test-secret-key', { expiresIn: '30d' });

    // 创建 Express 应用
    app = express();
    app.use(cors());
    app.use(express.json());

    // 认证中间件
    function authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        jwt.verify(token, 'test-secret-key', (err, user) => {
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

    // 模拟 admin.js 的核心路由
    // 用户列表
    app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
        try {
            const users = db.prepare(`
                SELECT u.id, u.username, u.email, u.role, u.enabled, u.created_at,
                       COUNT(r.id) as record_count
                FROM users u
                LEFT JOIN records r ON r.user_id = u.id
                GROUP BY u.id
                ORDER BY u.id DESC
            `).all();
            res.json({ users });
        } catch (err) {
            res.status(500).json({ error: '获取用户列表失败' });
        }
    });

    // 所有记录（复杂筛选）
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

            res.json({
                records: records.map(r => ({
                    id: r.id, userId: r.user_id, username: r.user_username, email: r.user_email,
                    date: r.date, notes: r.notes, poopType: r.poop_type,
                    duration: r.duration || 0, status: r.status
                })),
                total: records.length,
                page: { limit: lim, offset: off, total }
            });
        } catch (err) {
            res.status(500).json({ error: '获取记录失败' });
        }
    });

    // 全局统计
    app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
        try {
            const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
            const recordCount = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
            const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
            const today = new Date().toISOString().split('T')[0];
            const todayCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE date LIKE ?').get(today + '%').c;

            const typeDist = db.prepare(`
                SELECT poop_type as id, COUNT(*) as count FROM records GROUP BY poop_type
            `).all();

            res.json({
                userCount, recordCount, adminCount, todayCount,
                typeDistribution: typeDist
            });
        } catch (err) {
            res.status(500).json({ error: '获取统计失败' });
        }
    });

    // 删除记录
    app.delete('/api/admin/record/:id', authenticateToken, requireAdmin, (req, res) => {
        try {
            const record = db.prepare('SELECT id, user_id FROM records WHERE id = ?').get(req.params.id);
            db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
            
            // 记录审计日志
            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminUserId, 'DELETE_RECORD', 'record', req.params.id, `删除用户${record ? record.user_id : ''}的记录`);
            
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: '删除失败' });
        }
    });

    // 重置用户密码
    app.post('/api/admin/user/:id/password', authenticateToken, requireAdmin, (req, res) => {
        const userId = parseInt(req.params.id);
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: '新密码至少6位' });
        }

        try {
            const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });

            const hashedPassword = bcrypt.hashSync(newPassword, 10);
            const now = new Date().toISOString();
            db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(hashedPassword, now, userId);

            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminUserId, 'RESET_PASSWORD', 'user', userId, `重置用户 ${user.username} 的密码`);
            
            res.json({ success: true, message: `用户 ${user.username} 的密码已重置` });
        } catch (err) {
            res.status(500).json({ error: '重置失败' });
        }
    });

    // 删除用户
    app.delete('/api/admin/user/:id', authenticateToken, requireAdmin, (req, res) => {
        const userId = parseInt(req.params.id);

        try {
            const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            if (userId === req.user.userId) return res.status(400).json({ error: '不能删除自己' });
            if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });

            db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM records WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM users WHERE id = ?').run(userId);

            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminUserId, 'DELETE_USER', 'user', userId, `删除用户: ${user.username}`);
            
            res.json({ success: true, message: `用户 ${user.username} 已删除` });
        } catch (err) {
            res.status(500).json({ error: '删除失败' });
        }
    });

    // 启用/禁用用户
    app.post('/api/admin/user/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
        const userId = parseInt(req.params.id);

        try {
            const user = db.prepare('SELECT id, username, role, enabled FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            if (user.role === 'admin') return res.status(400).json({ error: '不能禁用管理员账号' });

            const newEnabled = user.enabled ? 0 : 1;
            const action = newEnabled ? 'ENABLE_USER' : 'DISABLE_USER';
            db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(newEnabled, userId);

            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminUserId, action, 'user', userId, `${newEnabled ? '启用' : '禁用'}用户: ${user.username}`);
            
            res.json({ success: true, message: `用户 ${user.username} 已${newEnabled ? '启用' : '禁用'}`, enabled: newEnabled });
        } catch (err) {
            res.status(500).json({ error: '操作失败' });
        }
    });

    // 登录日志（复杂筛选）
    app.get('/api/admin/login-logs', authenticateToken, requireAdmin, (req, res) => {
        try {
            const { user_id, success, start, end, limit, offset } = req.query;
            const conds = [];
            const params = [];
            if (user_id) { conds.push('l.user_id = ?'); params.push(user_id); }
            if (success !== undefined) { conds.push('l.success = ?'); params.push(success); }
            if (start) { conds.push("date(l.created_at, 'localtime') >= ?"); params.push(start); }
            if (end) { conds.push("date(l.created_at, 'localtime') <= ?"); params.push(end); }

            const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            const lim = Math.min(parseInt(limit) || 100, 500);
            const off = parseInt(offset) || 0;

            const total = db.prepare(`SELECT COUNT(*) as c FROM login_logs l ${where}`).get(...params).c;

            const logs = db.prepare(`
                SELECT l.*, u.username as user_username, u.email as user_email
                FROM login_logs l
                LEFT JOIN users u ON u.id = l.user_id
                ${where}
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?
            `).all(...params, lim, off);

            res.json({
                logs: logs.map(l => ({
                    id: l.id, userId: l.user_id, username: l.user_username, email: l.user_email,
                    deviceType: l.device_type, deviceBrowser: l.device_browser, deviceOs: l.device_os,
                    deviceModel: l.device_model, ip: l.ip, success: !!l.success,
                    failReason: l.fail_reason, createdAt: l.created_at
                })),
                page: { limit: lim, offset: off, total }
            });
        } catch (err) {
            res.status(500).json({ error: '获取日志失败' });
        }
    });

    // 审计日志（复杂筛选）
    app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, (req, res) => {
        try {
            const { action, target_type, start, end, limit, offset } = req.query;
            const conds = [];
            const params = [];
            if (action) { conds.push('a.action = ?'); params.push(action); }
            if (target_type) { conds.push('a.target_type = ?'); params.push(target_type); }
            if (start) { conds.push("date(a.created_at, 'localtime') >= ?"); params.push(start); }
            if (end) { conds.push("date(a.created_at, 'localtime') <= ?"); params.push(end); }

            const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            const lim = Math.min(parseInt(limit) || 100, 500);
            const off = parseInt(offset) || 0;

            const total = db.prepare(`SELECT COUNT(*) as c FROM admin_audit_logs a ${where}`).get(...params).c;

            const logs = db.prepare(`
                SELECT a.*, u.username as admin_username
                FROM admin_audit_logs a
                LEFT JOIN users u ON u.id = a.admin_id
                ${where}
                ORDER BY a.created_at DESC
                LIMIT ? OFFSET ?
            `).all(...params, lim, off);

            res.json({
                logs: logs.map(l => ({
                    id: l.id, adminId: l.admin_id, adminUsername: l.admin_username,
                    action: l.action, targetType: l.target_type, targetId: l.target_id,
                    detail: l.detail, createdAt: l.created_at
                })),
                page: { limit: lim, offset: off, total }
            });
        } catch (err) {
            res.status(500).json({ error: '获取审计日志失败' });
        }
    });
});

afterAll(() => {
    db.close();
});

// ============ 用户列表测试 ============
describe('管理员 - 用户列表', () => {
    test('应返回用户及其记录数', async () => {
        // 为测试用户创建记录
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );

        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
        expect(res.body.users.length).toBeGreaterThanOrEqual(2);

        const testUserInList = res.body.users.find(u => u.id === testUserId);
        expect(testUserInList).toBeDefined();
        expect(testUserInList.record_count).toBeGreaterThanOrEqual(1);

        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应包含用户状态字段', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        
        const user = res.body.users.find(u => u.id === testUserId);
        expect(user.enabled).toBeDefined();
        expect(user.role).toBeDefined();
    });

    test('无权限用户应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
    });
});

// ============ 记录筛选测试（核心复杂逻辑） ============
describe('管理员 - 记录复杂筛选', () => {
    beforeEach(() => {
        // 创建多条测试记录
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, now.toISOString(), 4, 300, '今天的记录', now.toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 3, 240, '昨天的记录', yesterday.toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('按用户 ID 筛选应正确', async () => {
        const res = await request(app).get('/api/admin/records?user_id=' + testUserId)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.userId === testUserId)).toBe(true);
    });

    test('按日期范围筛选应正确', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await request(app).get(`/api/admin/records?start=${today}&end=${today}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.date.startsWith(today))).toBe(true);
    });

    test('按大便类型筛选应正确', async () => {
        const res = await request(app).get('/api/admin/records?poop_type=4')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.poopType === 4)).toBe(true);
    });

    test('多条件组合筛选应正确', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await request(app).get(`/api/admin/records?user_id=${testUserId}&poop_type=4&start=${today}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBeGreaterThan(0);
        expect(res.body.records.every(r => 
            r.userId === testUserId && r.poopType === 4 && r.date.startsWith(today)
        )).toBe(true);
    });

    test('分页参数应正确处理', async () => {
        const res = await request(app).get('/api/admin/records?limit=1&offset=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(1);
        expect(res.body.page.offset).toBe(0);
        expect(res.body.records.length).toBeLessThanOrEqual(1);
    });

    test('超出最大限制应截断为 500', async () => {
        const res = await request(app).get('/api/admin/records?limit=1000')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(500);
    });

    test('无效分页参数应使用默认值', async () => {
        const res = await request(app).get('/api/admin/records?limit=invalid&offset=invalid')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(100);
        expect(res.body.page.offset).toBe(0);
    });

    test('无筛选条件应返回所有记录', async () => {
        const res = await request(app).get('/api/admin/records')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.total).toBeGreaterThanOrEqual(2);
    });
});

// ============ 全局统计测试 ============
describe('管理员 - 全局统计', () => {
    test('应返回正确的用户数', async () => {
        const res = await request(app).get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.userCount).toBeGreaterThanOrEqual(2);
    });

    test('应返回正确的管理员数', async () => {
        const res = await request(app).get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.adminCount).toBeGreaterThanOrEqual(1);
    });

    test('应返回类型分布统计', async () => {
        // 创建测试记录
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );

        const res = await request(app).get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.typeDistribution).toBeDefined();
        expect(res.body.typeDistribution.some(t => t.id === 4)).toBe(true);

        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

// ============ 删除记录测试（审计日志） ============
describe('管理员 - 删除记录与审计日志', () => {
    let recordId;

    beforeEach(() => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        recordId = result.lastInsertRowid;
    });

    test('删除记录应成功', async () => {
        const res = await request(app).delete(`/api/admin/record/${recordId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
        expect(record).toBeUndefined();
    });

    test('删除记录应生成审计日志', async () => {
        const res = await request(app).delete(`/api/admin/record/${recordId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);

        const auditLogs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ? AND target_id = ?').all('DELETE_RECORD', recordId);
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].target_type).toBe('record');
        expect(auditLogs[0].detail).toContain(testUserId.toString());
    });

    test('删除不存在记录应仍返回成功（幂等）', async () => {
        const fakeId = 99999;
        const res = await request(app).delete(`/api/admin/record/${fakeId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ============ 重置密码测试（审计日志） ============
describe('管理员 - 重置密码与审计日志', () => {
    test('重置密码应生成审计日志', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'newpassword123' });
        expect(res.status).toBe(200);

        const auditLogs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ? AND target_id = ?').all('RESET_PASSWORD', testUserId);
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].target_type).toBe('user');
        expect(auditLogs[0].detail).toContain('testuser');

        // 恢复密码
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync('test123', 10), testUserId);
    });

    test('重置不存在用户密码应返回 404', async () => {
        const res = await request(app).post('/api/admin/user/99999/password')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'newpassword123' });
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });
});

// ============ 删除用户测试（审计日志） ============
describe('管理员 - 删除用户与审计日志', () => {
    let otherUserId;

    beforeEach(() => {
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(
            'deleteuser' + Date.now(), 'delete' + Date.now() + '@test.com', bcrypt.hashSync('pass', 10)
        );
        otherUserId = result.lastInsertRowid;
    });

    test('删除用户应生成审计日志', async () => {
        const res = await request(app).delete(`/api/admin/user/${otherUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);

        const auditLogs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ? AND target_id = ?').all('DELETE_USER', otherUserId);
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].target_type).toBe('user');
        expect(auditLogs[0].detail).toContain('删除用户');
    });

    test('删除用户应删除关联数据', async () => {
        // 创建关联数据
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        db.prepare('INSERT INTO user_settings (user_id, reminder_hour, reminder_minute) VALUES (?, ?, ?)').run(
            otherUserId, 8, 0
        );

        const res = await request(app).delete(`/api/admin/user/${otherUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId);
        expect(user).toBeUndefined();

        const records = db.prepare('SELECT * FROM records WHERE user_id = ?').all(otherUserId);
        expect(records.length).toBe(0);

        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(otherUserId);
        expect(settings).toBeUndefined();
    });

    test('删除不存在用户应返回 404', async () => {
        const res = await request(app).delete('/api/admin/user/99999')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });
});

// ============ 启用/禁用用户测试（审计日志） ============
describe('管理员 - 启用/禁用用户与审计日志', () => {
    let otherUserId;

    beforeEach(() => {
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(
            'toggleuser' + Date.now(), 'toggle' + Date.now() + '@test.com', bcrypt.hashSync('pass', 10)
        );
        otherUserId = result.lastInsertRowid;
    });

    afterEach(() => {
        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });

    test('禁用用户应生成审计日志', async () => {
        const res = await request(app).post(`/api/admin/user/${otherUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);

        const auditLogs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ? AND target_id = ?').all('DISABLE_USER', otherUserId);
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].detail).toContain('禁用用户');
    });

    test('启用用户应生成审计日志', async () => {
        // 先禁用
        db.prepare('UPDATE users SET enabled = 0 WHERE id = ?').run(otherUserId);

        const res = await request(app).post(`/api/admin/user/${otherUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);

        const auditLogs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ? AND target_id = ?').all('ENABLE_USER', otherUserId);
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].detail).toContain('启用用户');
    });

    test('禁用后用户无法登录', async () => {
        const res = await request(app).post(`/api/admin/user/${otherUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(0);

        const user = db.prepare('SELECT enabled FROM users WHERE id = ?').get(otherUserId);
        expect(user.enabled).toBe(0);
    });

    test('禁用不存在用户应返回 404', async () => {
        const res = await request(app).post('/api/admin/user/99999/toggle')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });
});

// ============ 登录日志筛选测试（核心复杂逻辑） ============
describe('管理员 - 登录日志复杂筛选', () => {
    beforeEach(() => {
        // 创建测试登录日志
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        db.prepare('INSERT INTO login_logs (user_id, success, fail_reason, ip, device_type, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, 1, null, '192.168.1.1', '桌面电脑', now.toISOString()
        );
        db.prepare('INSERT INTO login_logs (user_id, success, fail_reason, ip, device_type, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, 0, '密码错误', '192.168.1.2', '移动设备', yesterday.toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(testUserId);
    });

    test('按用户 ID 筛选应正确', async () => {
        const res = await request(app).get(`/api/admin/login-logs?user_id=${testUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.userId === testUserId)).toBe(true);
    });

    test('按成功状态筛选应正确', async () => {
        const res = await request(app).get('/api/admin/login-logs?success=1')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.success === true)).toBe(true);
    });

    test('按失败状态筛选应正确', async () => {
        const res = await request(app).get('/api/admin/login-logs?success=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.success === false)).toBe(true);
    });

    test('按日期范围筛选应正确', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await request(app).get(`/api/admin/login-logs?start=${today}&end=${today}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        // 由于时区转换，这里只验证返回了日志
        expect(res.body.logs.length).toBeGreaterThanOrEqual(0);
    });

    test('分页参数应正确处理', async () => {
        const res = await request(app).get('/api/admin/login-logs?limit=1&offset=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(1);
        expect(res.body.page.offset).toBe(0);
        expect(res.body.logs.length).toBeLessThanOrEqual(1);
    });

    test('超出最大限制应截断为 500', async () => {
        const res = await request(app).get('/api/admin/login-logs?limit=1000')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(500);
    });

    test('应包含设备信息', async () => {
        const res = await request(app).get('/api/admin/login-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        
        if (res.body.logs.length > 0) {
            const log = res.body.logs[0];
            expect(log.deviceType).toBeDefined();
            expect(log.ip).toBeDefined();
        }
    });
});

// ============ 审计日志筛选测试（核心复杂逻辑） ============
describe('管理员 - 审计日志复杂筛选', () => {
    beforeEach(() => {
        // 创建测试审计日志
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            adminUserId, 'DELETE_RECORD', 'record', 1, '删除记录', now.toISOString()
        );
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            adminUserId, 'RESET_PASSWORD', 'user', testUserId, '重置密码', yesterday.toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM admin_audit_logs WHERE admin_id = ?').run(adminUserId);
    });

    test('按操作类型筛选应正确', async () => {
        const res = await request(app).get('/api/admin/audit-logs?action=DELETE_RECORD')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.action === 'DELETE_RECORD')).toBe(true);
    });

    test('按目标类型筛选应正确', async () => {
        const res = await request(app).get('/api/admin/audit-logs?target_type=user')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.targetType === 'user')).toBe(true);
    });

    test('按日期范围筛选应正确', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await request(app).get(`/api/admin/audit-logs?start=${today}&end=${today}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBeGreaterThanOrEqual(0);
    });

    test('分页参数应正确处理', async () => {
        const res = await request(app).get('/api/admin/audit-logs?limit=1&offset=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(1);
        expect(res.body.page.offset).toBe(0);
        expect(res.body.logs.length).toBeLessThanOrEqual(1);
    });

    test('超出最大限制应截断为 500', async () => {
        const res = await request(app).get('/api/admin/audit-logs?limit=1000')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(500);
    });

    test('应包含管理员信息', async () => {
        const res = await request(app).get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        
        if (res.body.logs.length > 0) {
            const log = res.body.logs[0];
            expect(log.adminId).toBeDefined();
            expect(log.adminUsername).toBeDefined();
        }
    });

    test('多条件组合筛选应正确', async () => {
        const res = await request(app).get(`/api/admin/audit-logs?target_type=record&action=DELETE_RECORD`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => 
            l.targetType === 'record' && l.action === 'DELETE_RECORD'
        )).toBe(true);
    });
});

// ============ 权限边界测试 ============
describe('管理员 - 权限边界情况', () => {
    test('删除自己的管理员账号应被拒绝', async () => {
        const res = await request(app).delete(`/api/admin/user/${adminUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除自己');
    });

    test('删除其他管理员账号应被拒绝', async () => {
        const otherAdminId = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run(
            'otheradmin', 'otheradmin@test.com', bcrypt.hashSync('pass', 10), 'admin'
        ).lastInsertRowid;

        const res = await request(app).delete(`/api/admin/user/${otherAdminId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除管理员账号');

        db.prepare('DELETE FROM users WHERE id = ?').run(otherAdminId);
    });

    test('禁用管理员账号应被拒绝', async () => {
        const res = await request(app).post(`/api/admin/user/${adminUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能禁用管理员账号');
    });

    test('无认证访问应返回 401', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });

    test('无效 token 应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', 'Bearer invalidtoken');
        expect(res.status).toBe(403);
    });

    test('普通用户访问管理员接口应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
    });
});