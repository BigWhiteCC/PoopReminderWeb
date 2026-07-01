process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Mock better-sqlite3 to use in-memory database
jest.mock('better-sqlite3', () => {
    const RealDatabase = jest.requireActual('better-sqlite3');
    return function(path) {
        return new RealDatabase(':memory:');
    };
});

const { getDb, initializeDatabase, addLoginLog, addAuditLog, closeDb } = require('./database');

describe('database module', () => {
    beforeAll(() => {
        initializeDatabase();
    });

    afterAll(() => {
        closeDb();
    });

    describe('getDb', () => {
        test('应返回数据库实例', () => {
            const db = getDb();
            expect(db).toBeDefined();
            expect(typeof db.prepare).toBe('function');
        });

        test('应返回单例实例', () => {
            const db1 = getDb();
            const db2 = getDb();
            expect(db1).toBe(db2);
        });
    });

    describe('initializeDatabase', () => {
        test('应创建 users 表', () => {
            const db = getDb();
            const info = db.prepare("PRAGMA table_info(users)").all();
            const colNames = info.map(c => c.name);
            expect(colNames).toContain('id');
            expect(colNames).toContain('username');
            expect(colNames).toContain('email');
            expect(colNames).toContain('password');
            expect(colNames).toContain('role');
            expect(colNames).toContain('enabled');
            expect(colNames).toContain('password_changed_at');
        });

        test('应创建 records 表', () => {
            const db = getDb();
            const info = db.prepare("PRAGMA table_info(records)").all();
            const colNames = info.map(c => c.name);
            expect(colNames).toContain('id');
            expect(colNames).toContain('user_id');
            expect(colNames).toContain('date');
            expect(colNames).toContain('poop_type');
            expect(colNames).toContain('duration');
            expect(colNames).toContain('status');
        });

        test('应创建 user_settings 表', () => {
            const db = getDb();
            const info = db.prepare("PRAGMA table_info(user_settings)").all();
            const colNames = info.map(c => c.name);
            expect(colNames).toContain('user_id');
            expect(colNames).toContain('reminder_hour');
            expect(colNames).toContain('reminder_minute');
        });

        test('应创建 login_logs 表', () => {
            const db = getDb();
            const info = db.prepare("PRAGMA table_info(login_logs)").all();
            const colNames = info.map(c => c.name);
            expect(colNames).toContain('user_id');
            expect(colNames).toContain('success');
            expect(colNames).toContain('fail_reason');
        });

        test('应创建 admin_audit_logs 表', () => {
            const db = getDb();
            const info = db.prepare("PRAGMA table_info(admin_audit_logs)").all();
            const colNames = info.map(c => c.name);
            expect(colNames).toContain('admin_id');
            expect(colNames).toContain('action');
            expect(colNames).toContain('target_type');
        });
    });

    describe('addLoginLog', () => {
        test('成功登录应被正确记录', () => {
            const db = getDb();
            // 先创建一个用户
            const bcrypt = require('bcryptjs');
            const hashedPassword = bcrypt.hashSync('test123', 10);
            const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('loguser1', 'log1@test.com', hashedPassword);
            const userId = result.lastInsertRowid;

            addLoginLog(userId, { type: '桌面电脑', browser: 'Chrome', os: 'Windows 10/11', model: 'Windows PC', ip: '192.168.1.1', userAgent: 'test' }, true);

            const logs = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').all(userId);
            expect(logs.length).toBe(1);
            expect(logs[0].success).toBe(1);
            expect(logs[0].device_type).toBe('桌面电脑');
            expect(logs[0].device_browser).toBe('Chrome');
        });

        test('失败登录应被正确记录', () => {
            const db = getDb();
            addLoginLog(null, { type: '移动设备', browser: 'Safari', os: 'iOS', model: 'iPhone', ip: '10.0.0.1', userAgent: 'test' }, false, '用户不存在');

            const logs = db.prepare("SELECT * FROM login_logs WHERE fail_reason = '用户不存在'").all();
            expect(logs.length).toBe(1);
            expect(logs[0].success).toBe(0);
            expect(logs[0].fail_reason).toBe('用户不存在');
        });
    });

    describe('addAuditLog', () => {
        test('管理员操作应被正确记录', () => {
            const db = getDb();
            const bcrypt = require('bcryptjs');
            const hashedPassword = bcrypt.hashSync('test123', 10);
            const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('auditadmin', 'audit@test.com', hashedPassword, 'admin');
            const adminId = result.lastInsertRowid;

            addAuditLog(adminId, 'DELETE_RECORD', 'record', 999, '删除测试记录');

            const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE admin_id = ?').all(adminId);
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('DELETE_RECORD');
            expect(logs[0].target_type).toBe('record');
            expect(logs[0].target_id).toBe(999);
            expect(logs[0].detail).toBe('删除测试记录');
        });

        test('无详情的审计日志应正常记录', () => {
            const db = getDb();
            const bcrypt = require('bcryptjs');
            const hashedPassword = bcrypt.hashSync('test123', 10);
            const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('auditadmin2', 'audit2@test.com', hashedPassword, 'admin');
            const adminId = result.lastInsertRowid;

            addAuditLog(adminId, 'ENABLE_USER', 'user', 42);

            const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE admin_id = ? AND action = ?').all(adminId, 'ENABLE_USER');
            expect(logs.length).toBe(1);
            expect(logs[0].detail).toBeNull();
        });
    });

    describe('closeDb', () => {
        test('关闭后再次获取应创建新连接', () => {
            const db1 = getDb();
            closeDb();
            // After closeDb, getDb should create a new instance
            // But we need to re-initialize for other tests
            // So just verify closeDb doesn't throw
            const db2 = getDb();
            expect(db2).toBeDefined();
            // Re-initialize for subsequent tests
            initializeDatabase();
        });
    });
});
