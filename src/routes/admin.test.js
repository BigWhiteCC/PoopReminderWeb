/**
 * 管理员路由集成测试
 * 重点覆盖：权限校验、用户管理、审计日志、敏感操作
 */

process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

// 创建测试数据库和应用
let app;
let db;
let testUserId;
let adminUserId;
let testToken;
let adminToken;

// 模拟数据库模块 - 延迟创建数据库实例
let mockDb;
jest.mock('../database', () => ({
    getDb: () => mockDb,
    addAuditLog: jest.fn((adminId, action, targetType, targetId, detail) => {
        if (mockDb) {
            mockDb.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(adminId, action, targetType, targetId, detail, new Date().toISOString());
        }
    }),
    addLoginLog: jest.fn()
}));

// 模拟 middleware 模块
jest.mock('../middleware', () => {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = 'test-secret-key';

    const authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: 'Invalid token' });
            req.user = user;
            next();
        });
    };

    const requireAdmin = (req, res, next) => {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: '需要管理员权限' });
        }
        next();
    };

    const handleError = (err, context) => {
        console.error(`[Error] ${context}:`, err.message);
        if (err.message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
            return { status: 409, message: '该数据已存在，请换一个试试' };
        }
        if (err.message.includes('SQLITE_CONSTRAINT')) {
            return { status: 400, message: '数据约束冲突，请检查输入' };
        }
        return { status: 500, message: '服务器异常，请稍后重试' };
    };

    return {
        authenticateToken,
        requireAdmin,
        handleError,
        escapeHtml: (str) => str ? str.toString() : ''
    };
});

// 模拟 records 模块
jest.mock('../records', () => ({
    queryRecords: jest.fn(() => []),
    computeStats: jest.fn(() => ({ total: 0, typeCounts: {}, avgDuration: 0 }))
}));

// 模拟 utils 模块
jest.mock('../utils', () => ({
    mapRecord: jest.fn((r) => ({
        id: r.id,
        userId: r.user_id,
        date: r.date,
        notes: r.notes,
        poopType: r.poop_type,
        duration: r.duration || 0,
        status: r.status
    }))
}));

beforeAll(() => {
    // 创建内存数据库
    db = new Database(':memory:');
    mockDb = db; // 赋值给 mockDb

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
    `);

    // 创建测试用户和管理员
    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, 'test-secret-key', { expiresIn: '30d' });

    const adminPassword = bcrypt.hashSync('admin123', 10);
    const adminResult = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', adminPassword, 'admin');
    adminUserId = adminResult.lastInsertRowid;
    adminToken = jwt.sign({ userId: adminUserId, username: 'admin', role: 'admin' }, 'test-secret-key', { expiresIn: '30d' });

    // 创建 express 应用
    app = express();
    app.use(express.json());

    // 导入并注册路由（由于 mock，需要手动创建路由）
    const adminRouter = require('./admin');
    app.use('/api/admin', adminRouter);
});

afterAll(() => {
    db.close();
});

// ============ 权限校验测试 ============
describe('管理员路由 - 权限校验', () => {
    test('无 token 访问应返回 401', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    test('普通用户访问应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('管理员权限');
    });

    test('无效 token 应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', 'Bearer invalid-token');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Invalid token');
    });

    test('管理员访问应成功', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
    });
});

// ============ 用户列表测试 ============
describe('管理员 API - 用户列表', () => {
    test('应返回所有用户及其记录数', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
        expect(res.body.users.length).toBeGreaterThanOrEqual(2);
        expect(res.body.users[0].id).toBeDefined();
        expect(res.body.users[0].username).toBeDefined();
        expect(res.body.users[0].role).toBeDefined();
        expect(res.body.users[0].enabled).toBeDefined();
        expect(res.body.users[0].record_count).toBeDefined();
    });
});

// ============ 全局统计测试 ============
describe('管理员 API - 全局统计', () => {
    test('应返回统计数据', async () => {
        const res = await request(app).get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.userCount).toBeDefined();
        expect(res.body.recordCount).toBeDefined();
        expect(res.body.adminCount).toBeDefined();
        expect(res.body.todayCount).toBeDefined();
        expect(res.body.typeDistribution).toBeDefined();
        expect(res.body.trend).toBeDefined();
    });
});

// ============ 重置密码测试 ============
describe('管理员 API - 重置密码', () => {
    test('密码过短应返回 400', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: '123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('至少6位');
    });

    test('用户不存在应返回 404', async () => {
        const res = await request(app).post('/api/admin/user/9999/password')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'newpassword123' });
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });

    test('正常重置应成功', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'adminreset123' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('密码已重置');

        // 验证密码已被修改
        const user = db.prepare('SELECT password, password_changed_at FROM users WHERE id = ?').get(testUserId);
        expect(bcrypt.compareSync('adminreset123', user.password)).toBe(true);
        expect(user.password_changed_at).toBeDefined();
    });
});

// ============ 删除用户测试 ============
describe('管理员 API - 删除用户', () => {
    test('删除自己应返回 400', async () => {
        const res = await request(app).delete(`/api/admin/user/${adminUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除自己');
    });

    test('删除管理员应返回 400', async () => {
        const otherAdminId = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('otheradmin', 'other@admin.com', bcrypt.hashSync('pass', 10), 'admin').lastInsertRowid;

        const res = await request(app).delete(`/api/admin/user/${otherAdminId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除管理员账号');

        db.prepare('DELETE FROM users WHERE id = ?').run(otherAdminId);
    });

    test('删除不存在用户应返回 404', async () => {
        const res = await request(app).delete('/api/admin/user/9999')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });

    test('删除普通用户应成功并清理相关数据', async () => {
        // 创建用户及相关数据
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('deleteme', 'delete@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(otherUserId, new Date().toISOString(), 4, new Date().toISOString());
        db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(otherUserId);

        const res = await request(app).delete(`/api/admin/user/${otherUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('已删除');

        // 验证用户及相关数据已被删除
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(otherUserId);
        expect(user).toBeUndefined();

        const records = db.prepare('SELECT * FROM records WHERE user_id = ?').all(otherUserId);
        expect(records.length).toBe(0);

        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(otherUserId);
        expect(settings).toBeUndefined();
    });
});

// ============ 启用/禁用用户测试 ============
describe('管理员 API - 启用/禁用用户', () => {
    test('禁用管理员应返回 400', async () => {
        const res = await request(app).post(`/api/admin/user/${adminUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能禁用管理员账号');
    });

    test('用户不存在应返回 404', async () => {
        const res = await request(app).post('/api/admin/user/9999/toggle')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });

    test('禁用普通用户应成功', async () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('toggleuser', 'toggle@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;

        const res = await request(app).post(`/api/admin/user/${otherUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.enabled).toBe(0);

        const user = db.prepare('SELECT enabled FROM users WHERE id = ?').get(otherUserId);
        expect(user.enabled).toBe(0);

        // 再次调用应启用
        const res2 = await request(app).post(`/api/admin/user/${otherUserId}/toggle`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res2.status).toBe(200);
        expect(res2.body.enabled).toBe(1);

        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });
});

// ============ 删除记录测试 ============
describe('管理员 API - 删除记录', () => {
    let recordId;

    beforeEach(() => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, new Date().toISOString(), 4, new Date().toISOString());
        recordId = result.lastInsertRowid;
    });

    afterEach(() => {
        try {
            db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
        } catch (e) {}
    });

    test('管理员删除任意记录应成功', async () => {
        const res = await request(app).delete(`/api/admin/record/${recordId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
        expect(record).toBeUndefined();
    });

    test('删除不存在记录应仍返回成功（业务逻辑）', async () => {
        const res = await request(app).delete('/api/admin/record/9999')
            .set('Authorization', `Bearer ${adminToken}`);
        // SQLite DELETE 不存在的记录不会抛错
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ============ 登录日志测试 ============
describe('管理员 API - 登录日志', () => {
    test('应返回空日志列表', async () => {
        const res = await request(app).get('/api/admin/login-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('筛选条件应生效', async () => {
        // 插入测试登录日志
        db.prepare('INSERT INTO login_logs (user_id, success, created_at) VALUES (?, ?, ?)').run(testUserId, 1, new Date().toISOString());

        const res = await request(app).get('/api/admin/login-logs?user_id=' + testUserId + '&success=1')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBeGreaterThanOrEqual(1);
        expect(res.body.logs[0].userId).toBe(testUserId);
        expect(res.body.logs[0].success).toBe(true);

        db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(testUserId);
    });
});

// ============ 审计日志测试 ============
describe('管理员 API - 审计日志', () => {
    test('应返回空日志列表', async () => {
        const res = await request(app).get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('筛选条件应生效', async () => {
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, created_at) VALUES (?, ?, ?, ?)').run(adminUserId, 'DELETE_USER', 'user', new Date().toISOString());

        const res = await request(app).get('/api/admin/audit-logs?action=DELETE_USER')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBeGreaterThanOrEqual(1);
        expect(res.body.logs[0].action).toBe('DELETE_USER');

        db.prepare('DELETE FROM admin_audit_logs WHERE admin_id = ?').run(adminUserId);
    });
});

// ============ 所有记录测试 ============
describe('管理员 API - 所有记录', () => {
    beforeEach(() => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, '正常', new Date().toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回所有记录', async () => {
        const res = await request(app).get('/api/admin/records')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.total).toBeDefined();
        expect(res.body.avgDuration).toBeDefined();
        expect(res.body.typeStats).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('筛选用户应生效', async () => {
        const res = await request(app).get(`/api/admin/records?user_id=${testUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBeGreaterThanOrEqual(1);
        expect(res.body.records[0].userId).toBe(testUserId);
    });

    test('筛选日期范围应生效', async () => {
        const res = await request(app).get('/api/admin/records?start=2024-01-01&end=2024-01-31')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBeGreaterThanOrEqual(1);
    });

    test('筛选大便类型应生效', async () => {
        const res = await request(app).get('/api/admin/records?poop_type=4')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBeGreaterThanOrEqual(1);
    });
});