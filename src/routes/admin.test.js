process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

let mockDb;
jest.mock('../database', () => ({
    getDb: () => mockDb,
    addLoginLog: () => {},
    addAuditLog: () => {}
}));

const adminRouter = require('./admin');

let app;
let adminToken;
let userToken;
let adminUserId;
let regularUserId;

beforeAll(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE records (
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
        CREATE TABLE login_logs (
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
        CREATE TABLE admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_records_user_id ON records(user_id);
        CREATE INDEX idx_login_logs_user_id ON login_logs(user_id);
        CREATE INDEX idx_audit_logs_admin_id ON admin_audit_logs(admin_id);
    `);

    const adminId = mockDb.prepare(
        'INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?, ?, ?, ?, ?)'
    ).run('root', 'root@test.com', 'hash', 'admin', new Date('2024-01-01').toISOString()).lastInsertRowid;
    adminUserId = adminId;

    regularUserId = mockDb.prepare(
        'INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?, ?, ?, ?, ?)'
    ).run('bob', 'bob@test.com', 'hash', 'user', new Date('2024-01-01').toISOString()).lastInsertRowid;

    adminToken = jwt.sign(
        { userId: adminUserId, username: 'root', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );
    userToken = jwt.sign(
        { userId: regularUserId, username: 'bob', role: 'user' },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
});

afterAll(() => {
    mockDb.close();
});

function asAdmin(req) {
    return req.set('Authorization', `Bearer ${adminToken}`);
}
function asUser(req) {
    return req.set('Authorization', `Bearer ${userToken}`);
}

// ============ 权限闸门：所有管理员接口 ============
describe('管理员路由 - 权限闸门', () => {
    test('未认证访问 /api/admin/users 应返回 401', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });

    test('普通用户访问 /api/admin/users 应返回 403', async () => {
        const res = await asUser(request(app).get('/api/admin/users'));
        expect(res.status).toBe(403);
    });

    test('普通用户访问 /api/admin/records 应返回 403', async () => {
        const res = await asUser(request(app).get('/api/admin/records'));
        expect(res.status).toBe(403);
    });

    test('普通用户访问 /api/admin/stats 应返回 403', async () => {
        const res = await asUser(request(app).get('/api/admin/stats'));
        expect(res.status).toBe(403);
    });

    test('普通用户访问 /api/admin/login-logs 应返回 403', async () => {
        const res = await asUser(request(app).get('/api/admin/login-logs'));
        expect(res.status).toBe(403);
    });

    test('普通用户访问 /api/admin/audit-logs 应返回 403', async () => {
        const res = await asUser(request(app).get('/api/admin/audit-logs'));
        expect(res.status).toBe(403);
    });
});

// ============ /api/admin/records：管理员全量记录查询 ============
describe('GET /api/admin/records - 管理员全量记录', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records').run();
    });

    test('应返回所有用户的记录并包含用户名/邮箱', async () => {
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)`)
            .run(regularUserId, '2024-01-15T10:00:00', 4, '2024-01-15T10:00:00');
        const res = await asAdmin(request(app).get('/api/admin/records'));
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].username).toBe('bob');
        expect(res.body.records[0].email).toBe('bob@test.com');
        expect(res.body.page.total).toBe(1);
    });

    test('user_id 过滤应仅返回该用户记录', async () => {
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)`)
            .run(regularUserId, '2024-01-15T10:00:00', 4, '2024-01-15T10:00:00');
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)`)
            .run(adminUserId, '2024-01-16T10:00:00', 5, '2024-01-16T10:00:00');
        const res = await asAdmin(request(app).get(`/api/admin/records?user_id=${regularUserId}`));
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].userId).toBe(regularUserId);
    });

    test('poop_type 过滤应仅返回匹配类型', async () => {
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)`)
            .run(regularUserId, '2024-01-15T10:00:00', 4, '2024-01-15T10:00:00');
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)`)
            .run(regularUserId, '2024-01-16T10:00:00', 7, '2024-01-16T10:00:00');
        const res = await asAdmin(request(app).get('/api/admin/records?poop_type=4'));
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].poopType).toBe(4);
    });

    test('limit 应被截断且不超过 500', async () => {
        for (let i = 0; i < 3; i++) {
            mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)`)
                .run(regularUserId, `2024-01-1${i + 1}T10:00:00`, 4, `2024-01-1${i + 1}T10:00:00`);
        }
        const res = await asAdmin(request(app).get('/api/admin/records?limit=2'));
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(2);
        expect(res.body.page.limit).toBe(2);
    });

    test('limit 超过 500 应被截断到 500', async () => {
        const res = await asAdmin(request(app).get('/api/admin/records?limit=9999'));
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(500);
    });

    test('应计算 typeStats 与 avgDuration', async () => {
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(regularUserId, '2024-01-15T10:00:00', 4, 300, '2024-01-15T10:00:00');
        mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(regularUserId, '2024-01-16T10:00:00', 4, 600, '2024-01-16T10:00:00');
        const res = await asAdmin(request(app).get('/api/admin/records'));
        expect(res.status).toBe(200);
        expect(res.body.typeStats[4]).toBe(2);
        expect(res.body.avgDuration).toBe(450); // (300+600)/2
    });
});

// ============ /api/admin/login-logs ============
describe('GET /api/admin/login-logs - 登录日志', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM login_logs').run();
    });

    test('空日志应返回空数组与正确的 page', async () => {
        const res = await asAdmin(request(app).get('/api/admin/login-logs'));
        expect(res.status).toBe(200);
        expect(res.body.logs).toEqual([]);
        expect(res.body.page).toEqual({ limit: 100, offset: 0, total: 0 });
    });

    test('应返回登录日志并附带用户名/邮箱', async () => {
        mockDb.prepare(`INSERT INTO login_logs (user_id, ip, user_agent, success, created_at)
                        VALUES (?, ?, ?, ?, ?)`)
            .run(regularUserId, '127.0.0.1', 'Mozilla/5.0', 1, '2024-01-15T10:00:00');
        const res = await asAdmin(request(app).get('/api/admin/login-logs'));
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBe(1);
        expect(res.body.logs[0].username).toBe('bob');
        expect(res.body.logs[0].email).toBe('bob@test.com');
        expect(res.body.logs[0].success).toBe(true);
        expect(res.body.logs[0].ip).toBe('127.0.0.1');
    });

    test('user_id 过滤应仅返回该用户的日志', async () => {
        const otherId = mockDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
            .run('eve', 'eve@test.com', 'hash').lastInsertRowid;
        mockDb.prepare(`INSERT INTO login_logs (user_id, success, created_at) VALUES (?, ?, ?)`)
            .run(regularUserId, 1, '2024-01-15T10:00:00');
        mockDb.prepare(`INSERT INTO login_logs (user_id, success, created_at) VALUES (?, ?, ?)`)
            .run(otherId, 1, '2024-01-15T10:00:00');
        const res = await asAdmin(request(app).get(`/api/admin/login-logs?user_id=${regularUserId}`));
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBe(1);
        expect(res.body.logs[0].userId).toBe(regularUserId);
    });

    test('success=0 应仅返回失败日志', async () => {
        mockDb.prepare(`INSERT INTO login_logs (user_id, success, fail_reason, created_at) VALUES (?, ?, ?, ?)`)
            .run(regularUserId, 0, '密码错误', '2024-01-15T10:00:00');
        mockDb.prepare(`INSERT INTO login_logs (user_id, success, created_at) VALUES (?, ?, ?)`)
            .run(regularUserId, 1, '2024-01-15T11:00:00');
        const res = await asAdmin(request(app).get('/api/admin/login-logs?success=0'));
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBe(1);
        expect(res.body.logs[0].success).toBe(false);
        expect(res.body.logs[0].failReason).toBe('密码错误');
    });

    test('limit 应被截断且不超过 500', async () => {
        const res = await asAdmin(request(app).get('/api/admin/login-logs?limit=9999'));
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(500);
    });
});

// ============ /api/admin/audit-logs ============
describe('GET /api/admin/audit-logs - 审计日志', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM admin_audit_logs').run();
    });

    test('空日志应返回空数组', async () => {
        const res = await asAdmin(request(app).get('/api/admin/audit-logs'));
        expect(res.status).toBe(200);
        expect(res.body.logs).toEqual([]);
        expect(res.body.page.total).toBe(0);
    });

    test('应返回审计日志并附带管理员用户名', async () => {
        mockDb.prepare(`INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)`)
            .run(adminUserId, 'RESET_PASSWORD', 'user', regularUserId, '重置用户 bob 的密码', '2024-01-15T10:00:00');
        const res = await asAdmin(request(app).get('/api/admin/audit-logs'));
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBe(1);
        expect(res.body.logs[0].adminUsername).toBe('root');
        expect(res.body.logs[0].action).toBe('RESET_PASSWORD');
        expect(res.body.logs[0].targetType).toBe('user');
        expect(res.body.logs[0].targetId).toBe(regularUserId);
        expect(res.body.logs[0].detail).toBe('重置用户 bob 的密码');
    });

    test('action 过滤应仅返回该动作的日志', async () => {
        mockDb.prepare(`INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, created_at)
                        VALUES (?, ?, ?, ?, ?)`)
            .run(adminUserId, 'RESET_PASSWORD', 'user', regularUserId, '2024-01-15T10:00:00');
        mockDb.prepare(`INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, created_at)
                        VALUES (?, ?, ?, ?, ?)`)
            .run(adminUserId, 'DELETE_USER', 'user', regularUserId, '2024-01-15T11:00:00');
        const res = await asAdmin(request(app).get('/api/admin/audit-logs?action=DELETE_USER'));
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBe(1);
        expect(res.body.logs[0].action).toBe('DELETE_USER');
    });

    test('应按 created_at 倒序返回', async () => {
        mockDb.prepare(`INSERT INTO admin_audit_logs (admin_id, action, target_type, created_at)
                        VALUES (?, ?, ?, ?)`)
            .run(adminUserId, 'FIRST', 'user', '2024-01-10T10:00:00');
        mockDb.prepare(`INSERT INTO admin_audit_logs (admin_id, action, target_type, created_at)
                        VALUES (?, ?, ?, ?)`)
            .run(adminUserId, 'SECOND', 'user', '2024-01-15T10:00:00');
        const res = await asAdmin(request(app).get('/api/admin/audit-logs'));
        expect(res.status).toBe(200);
        expect(res.body.logs[0].action).toBe('SECOND');
        expect(res.body.logs[1].action).toBe('FIRST');
    });
});

// ============ /api/admin/stats：全局统计 ============
describe('GET /api/admin/stats - 全局统计', () => {
    test('空数据库应返回 0 计数', async () => {
        mockDb.prepare('DELETE FROM users WHERE id NOT IN (?, ?)').run(adminUserId, regularUserId);
        mockDb.prepare('DELETE FROM records').run();
        const res = await asAdmin(request(app).get('/api/admin/stats'));
        expect(res.status).toBe(200);
        expect(res.body.userCount).toBeGreaterThanOrEqual(2);
        expect(res.body.adminCount).toBe(1);
        expect(res.body.typeDistribution).toBeDefined();
        expect(res.body.trend).toBeDefined();
    });
});
