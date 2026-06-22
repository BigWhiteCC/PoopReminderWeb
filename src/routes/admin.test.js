const request = require('supertest');
const express = require('express');
const Database = require('better-sqlite3');

const TEST_DB_PATH = ':memory:';
let db;
let app;
let adminToken;
let normalToken;

const createAppWithMockDb = (mockDb) => {
    const app = express();
    app.use(express.json());
    
    jest.resetModules();
    jest.doMock('../database', () => mockDb);
    jest.doMock('../middleware', () => {
        const original = jest.requireActual('../middleware');
        return {
            ...original,
            authenticateToken: (req, res, next) => {
                if (req.headers.authorization === `Bearer ${adminToken}`) {
                    req.user = { userId: 1, role: 'admin', username: 'admin' };
                } else if (req.headers.authorization === `Bearer ${normalToken}`) {
                    req.user = { userId: 2, role: 'user', username: 'user' };
                } else {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
                next();
            },
            requireAdmin: (req, res, next) => {
                if (req.user.role !== 'admin') {
                    return res.status(403).json({ error: 'Forbidden' });
                }
                next();
            }
        };
    });
    
    const adminRoutes = require('./admin');
    app.use('/api/admin', adminRoutes);
    
    return app;
};

beforeAll(() => {
    db = new Database(TEST_DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            enabled INTEGER DEFAULT 1
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
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            reminder_time TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            ip TEXT,
            success INTEGER DEFAULT 1,
            fail_reason TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    db.prepare('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)').run(1, 'admin', 'admin@test.com', 'hashed', 'admin');
    db.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)').run(2, 'user', 'user@test.com', 'hashed');
    db.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)').run(3, 'target', 'target@test.com', 'hashed');

    adminToken = 'admin-token';
    normalToken = 'normal-token';
});

afterAll(() => {
    db.close();
});

describe('Admin API - 用户管理', () => {
    beforeEach(() => {
        app = createAppWithMockDb({
            getDb: () => db,
            addAuditLog: jest.fn()
        });
    });

    test('非管理员应无法访问用户列表', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${normalToken}`);
        
        expect(res.status).toBe(403);
    });

    test('管理员应能获取用户列表', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
        expect(res.body.users.length).toBe(3);
    });

    test('管理员应能禁用用户', async () => {
        const res = await request(app)
            .post('/api/admin/user/3/toggle')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(0);
        
        const user = db.prepare('SELECT enabled FROM users WHERE id = ?').get(3);
        expect(user.enabled).toBe(0);
    });

    test('管理员应能启用用户', async () => {
        db.prepare('UPDATE users SET enabled = 0 WHERE id = 3').run();
        
        const res = await request(app)
            .post('/api/admin/user/3/toggle')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(1);
        
        const user = db.prepare('SELECT enabled FROM users WHERE id = ?').get(3);
        expect(user.enabled).toBe(1);
    });

    test('禁用不存在的用户应返回404', async () => {
        const res = await request(app)
            .post('/api/admin/user/999/toggle')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('用户不存在');
    });

    test('禁用管理员应返回400', async () => {
        const res = await request(app)
            .post('/api/admin/user/1/toggle')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('不能禁用管理员账号');
    });

    test('管理员应能删除用户', async () => {
        const res = await request(app)
            .delete('/api/admin/user/3')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(3);
        expect(user).toBeUndefined();
    });

    test('删除不存在的用户应返回404', async () => {
        const res = await request(app)
            .delete('/api/admin/user/999')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('用户不存在');
    });

    test('删除自己应返回400', async () => {
        const res = await request(app)
            .delete('/api/admin/user/1')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('不能删除自己');
    });

    test('删除管理员应返回400', async () => {
        db.prepare('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)').run(4, 'admin2', 'admin2@test.com', 'hashed', 'admin');
        
        const res = await request(app)
            .delete('/api/admin/user/4')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('不能删除管理员账号');
    });

    test('管理员应能重置用户密码', async () => {
        const res = await request(app)
            .post('/api/admin/user/2/password')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'newpassword123' });
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('重置密码太短应返回400', async () => {
        const res = await request(app)
            .post('/api/admin/user/2/password')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: '123' });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('新密码至少6位');
    });
});

describe('Admin API - 记录管理', () => {
    beforeEach(() => {
        app = createAppWithMockDb({
            getDb: () => db,
            addAuditLog: jest.fn()
        });
        db.prepare('DELETE FROM records').run();
    });

    test('管理员应能查看所有记录', async () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(2, '2024-01-15', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(2, '2024-01-16', 3);

        const res = await request(app)
            .get('/api/admin/records')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(2);
    });

    test('管理员应能删除记录', async () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(2, '2024-01-15', 4);
        const recordId = result.lastInsertRowid;

        const res = await request(app)
            .delete(`/api/admin/record/${recordId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        
        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
        expect(record).toBeUndefined();
    });
});

describe('Admin API - 统计', () => {
    beforeEach(() => {
        app = createAppWithMockDb({
            getDb: () => db,
            addAuditLog: jest.fn()
        });
        db.prepare('DELETE FROM records').run();
    });

    test('管理员应能获取系统统计', async () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(2, '2024-01-15', 4);

        const res = await request(app)
            .get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.userCount).toBeGreaterThan(0);
        expect(res.body.recordCount).toBe(1);
    });
});

describe('Admin API - 日志', () => {
    beforeEach(() => {
        app = createAppWithMockDb({
            getDb: () => db,
            addAuditLog: jest.fn()
        });
        db.prepare('DELETE FROM admin_audit_logs').run();
    });

    test('管理员应能获取审核日志', async () => {
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)').run(1, 'DISABLE_USER', 'user', 3, '禁用用户: target');

        const res = await request(app)
            .get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBe(1);
    });
});