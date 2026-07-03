process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const { getDb, initializeDatabase, addLoginLog, addAuditLog, closeDb } = require('./database');

describe('database - 数据库核心功能', () => {
    let testDb;

    beforeEach(() => {
        closeDb();
    });

    afterAll(() => {
        closeDb();
    });

    test('getDb 应返回数据库实例', () => {
        const db = getDb();
        expect(db).toBeDefined();
        expect(db.prepare).toBeInstanceOf(Function);
    });

    test('initializeDatabase 应创建所有必要的表', () => {
        const db = new Database(':memory:');
        const originalGetDb = require('./database').getDb;
        require('./database').getDb = () => db;

        initializeDatabase();

        const tables = ['users', 'records', 'user_settings', 'login_logs', 'admin_audit_logs'];
        tables.forEach(table => {
            const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
            expect(result).not.toBeUndefined();
            expect(result.name).toBe(table);
        });

        require('./database').getDb = originalGetDb;
        db.close();
    });

    test('initializeDatabase 应为 records 表添加缺失字段', () => {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                date TEXT NOT NULL
            )
        `);

        const originalGetDb = require('./database').getDb;
        require('./database').getDb = () => db;

        initializeDatabase();

        const info = db.prepare('PRAGMA table_info(records)').all();
        const columns = info.map(c => c.name);
        expect(columns).toContain('poop_type');
        expect(columns).toContain('duration');
        expect(columns).toContain('status');
        expect(columns).toContain('created_at');

        require('./database').getDb = originalGetDb;
        db.close();
    });

    test('initializeDatabase 应为 users 表添加缺失字段', () => {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
        `);

        const originalGetDb = require('./database').getDb;
        require('./database').getDb = () => db;

        initializeDatabase();

        const info = db.prepare('PRAGMA table_info(users)').all();
        const columns = info.map(c => c.name);
        expect(columns).toContain('role');
        expect(columns).toContain('enabled');
        expect(columns).toContain('password_changed_at');

        require('./database').getDb = originalGetDb;
        db.close();
    });
});

describe('addLoginLog - 登录日志记录', () => {
    let db;

    beforeAll(() => {
        db = new Database(':memory:');
        db.exec(`
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
            )
        `);

        const originalGetDb = require('./database').getDb;
        require('./database').getDb = () => db;
    });

    afterAll(() => {
        db.close();
    });

    beforeEach(() => {
        db.prepare('DELETE FROM login_logs').run();
    });

    test('应记录成功登录', () => {
        const device = {
            type: '桌面电脑',
            browser: 'Chrome',
            os: 'Windows 10/11',
            model: 'Windows PC',
            ip: '192.168.1.1',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
        };

        addLoginLog(1, device, true);

        const logs = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').all(1);
        expect(logs.length).toBe(1);
        expect(logs[0].success).toBe(1);
        expect(logs[0].device_type).toBe('桌面电脑');
        expect(logs[0].device_browser).toBe('Chrome');
        expect(logs[0].device_os).toBe('Windows 10/11');
        expect(logs[0].device_model).toBe('Windows PC');
        expect(logs[0].ip).toBe('192.168.1.1');
        expect(logs[0].fail_reason).toBeNull();
    });

    test('应记录失败登录', () => {
        const device = {
            type: '移动设备',
            browser: 'Safari',
            os: 'iOS',
            model: 'iPhone',
            ip: '10.0.0.1',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
        };

        addLoginLog(null, device, false, '用户不存在');

        const logs = db.prepare('SELECT * FROM login_logs WHERE success = 0').all();
        expect(logs.length).toBe(1);
        expect(logs[0].user_id).toBeNull();
        expect(logs[0].success).toBe(0);
        expect(logs[0].fail_reason).toBe('用户不存在');
    });

    test('应记录密码错误登录', () => {
        const device = { type: '桌面电脑', browser: 'Firefox', os: 'Linux', model: '', ip: '192.168.0.1', userAgent: '' };

        addLoginLog(2, device, false, '密码错误');

        const logs = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').all(2);
        expect(logs.length).toBe(1);
        expect(logs[0].fail_reason).toBe('密码错误');
    });

    test('应记录用户被禁用登录', () => {
        const device = { type: '桌面电脑', browser: 'Edge', os: 'Windows 10/11', model: 'Windows PC', ip: '192.168.1.2', userAgent: '' };

        addLoginLog(3, device, false, '用户已被禁用');

        const logs = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').all(3);
        expect(logs.length).toBe(1);
        expect(logs[0].fail_reason).toBe('用户已被禁用');
    });
});

describe('addAuditLog - 审计日志记录', () => {
    let db;

    beforeAll(() => {
        db = new Database(':memory:');
        db.exec(`
            CREATE TABLE IF NOT EXISTS admin_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id INTEGER,
                detail TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const originalGetDb = require('./database').getDb;
        require('./database').getDb = () => db;
    });

    afterAll(() => {
        db.close();
    });

    beforeEach(() => {
        db.prepare('DELETE FROM admin_audit_logs').run();
    });

    test('应记录删除记录操作', () => {
        addAuditLog(1, 'DELETE_RECORD', 'record', 100, '删除用户5的记录');

        const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE admin_id = ?').all(1);
        expect(logs.length).toBe(1);
        expect(logs[0].action).toBe('DELETE_RECORD');
        expect(logs[0].target_type).toBe('record');
        expect(logs[0].target_id).toBe(100);
        expect(logs[0].detail).toBe('删除用户5的记录');
    });

    test('应记录重置密码操作', () => {
        addAuditLog(1, 'RESET_PASSWORD', 'user', 2, '重置用户 testuser 的密码');

        const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('RESET_PASSWORD');
        expect(logs.length).toBe(1);
        expect(logs[0].target_type).toBe('user');
        expect(logs[0].target_id).toBe(2);
    });

    test('应记录删除用户操作', () => {
        addAuditLog(1, 'DELETE_USER', 'user', 3, '删除用户: deleteuser');

        const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('DELETE_USER');
        expect(logs.length).toBe(1);
        expect(logs[0].target_type).toBe('user');
        expect(logs[0].target_id).toBe(3);
    });

    test('应记录禁用用户操作', () => {
        addAuditLog(1, 'DISABLE_USER', 'user', 4, '禁用用户: toggleuser');

        const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('DISABLE_USER');
        expect(logs.length).toBe(1);
        expect(logs[0].detail).toBe('禁用用户: toggleuser');
    });

    test('应记录启用用户操作', () => {
        addAuditLog(1, 'ENABLE_USER', 'user', 4, '启用用户: toggleuser');

        const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('ENABLE_USER');
        expect(logs.length).toBe(1);
        expect(logs[0].detail).toBe('启用用户: toggleuser');
    });

    test('detail 为 null 时应正常记录', () => {
        addAuditLog(1, 'TEST_ACTION', 'test', 1, null);

        const logs = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('TEST_ACTION');
        expect(logs.length).toBe(1);
        expect(logs[0].detail).toBeNull();
    });
});

describe('closeDb - 数据库关闭', () => {
    test('closeDb 应关闭数据库连接', () => {
        const db = getDb();
        expect(db.open).toBe(true);

        closeDb();

        expect(() => db.prepare('SELECT 1').get()).toThrow();
    });

    test('重复调用 closeDb 不应报错', () => {
        closeDb();
        expect(() => closeDb()).not.toThrow();
    });
});