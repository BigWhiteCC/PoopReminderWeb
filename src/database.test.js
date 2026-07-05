process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');

let mockDb;

jest.mock('better-sqlite3', () => {
    const actual = jest.requireActual('better-sqlite3');
    return function MockDatabase(path, options) {
        if (mockDb && path === 'poopreminder.db') {
            return mockDb;
        }
        return new actual(path, options);
    };
});

let testUserId;

beforeAll(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(`
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
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES users(id)
        );
    `);

    const result = mockDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', 'hashed');
    testUserId = result.lastInsertRowid;
});

afterAll(() => {
    mockDb.close();
});

beforeEach(() => {
    mockDb.prepare('DELETE FROM login_logs').run();
    mockDb.prepare('DELETE FROM admin_audit_logs').run();
});

const { addLoginLog, addAuditLog, initializeDatabase } = require('./database');

describe('addLoginLog - 登录日志', () => {
    test('成功登录应正确记录', () => {
        const device = {
            type: '桌面电脑',
            browser: 'Chrome',
            os: 'Windows 10/11',
            model: 'Windows PC',
            ip: '192.168.1.1',
            userAgent: 'Chrome UA'
        };

        addLoginLog(testUserId, device, true);

        const logs = mockDb.prepare('SELECT * FROM login_logs WHERE user_id = ?').all(testUserId);
        expect(logs.length).toBe(1);
        expect(logs[0].success).toBe(1);
        expect(logs[0].device_type).toBe('桌面电脑');
        expect(logs[0].device_browser).toBe('Chrome');
        expect(logs[0].device_os).toBe('Windows 10/11');
        expect(logs[0].device_model).toBe('Windows PC');
        expect(logs[0].ip).toBe('192.168.1.1');
        expect(logs[0].user_agent).toBe('Chrome UA');
        expect(logs[0].fail_reason).toBeNull();
    });

    test('失败登录应正确记录原因', () => {
        const device = {
            type: '移动设备',
            browser: 'Safari',
            os: 'iOS',
            model: 'iPhone',
            ip: '10.0.0.1',
            userAgent: 'Safari UA'
        };

        addLoginLog(testUserId, device, false, '密码错误');

        const logs = mockDb.prepare('SELECT * FROM login_logs WHERE user_id = ?').all(testUserId);
        expect(logs.length).toBe(1);
        expect(logs[0].success).toBe(0);
        expect(logs[0].fail_reason).toBe('密码错误');
        expect(logs[0].device_type).toBe('移动设备');
        expect(logs[0].ip).toBe('10.0.0.1');
    });

    test('用户不存在时也应记录（user_id 为 null）', () => {
        const device = {
            type: '桌面电脑',
            browser: 'Firefox',
            os: 'Linux',
            model: '',
            ip: '172.16.0.1',
            userAgent: 'Firefox UA'
        };

        addLoginLog(null, device, false, '用户不存在');

        const logs = mockDb.prepare('SELECT * FROM login_logs WHERE ip = ?').all('172.16.0.1');
        expect(logs.length).toBe(1);
        expect(logs[0].user_id).toBeNull();
        expect(logs[0].success).toBe(0);
        expect(logs[0].fail_reason).toBe('用户不存在');
    });

    test('应自动设置创建时间', () => {
        const device = { type: '', browser: '', os: '', model: '', ip: '', userAgent: '' };
        const before = new Date();

        addLoginLog(testUserId, device, true);

        const log = mockDb.prepare('SELECT * FROM login_logs WHERE user_id = ?').get(testUserId);
        const createdAt = new Date(log.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });
});

describe('addAuditLog - 审计日志', () => {
    test('应正确记录管理员操作', () => {
        addAuditLog(testUserId, 'DELETE_USER', 'user', 123, '删除用户 testuser');

        const logs = mockDb.prepare('SELECT * FROM admin_audit_logs WHERE admin_id = ?').all(testUserId);
        expect(logs.length).toBe(1);
        expect(logs[0].action).toBe('DELETE_USER');
        expect(logs[0].target_type).toBe('user');
        expect(logs[0].target_id).toBe(123);
        expect(logs[0].detail).toBe('删除用户 testuser');
    });

    test('target_id 为 null 时应正确记录', () => {
        addAuditLog(testUserId, 'VIEW_STATS', 'system', null, '查看系统统计');

        const logs = mockDb.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('VIEW_STATS');
        expect(logs.length).toBe(1);
        expect(logs[0].target_type).toBe('system');
        expect(logs[0].target_id).toBeNull();
    });

    test('detail 为 null 时应正确记录', () => {
        addAuditLog(testUserId, 'LOGIN', 'session', null, null);

        const logs = mockDb.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('LOGIN');
        expect(logs.length).toBe(1);
        expect(logs[0].detail).toBeNull();
    });

    test('应自动设置创建时间', () => {
        const before = new Date();

        addAuditLog(testUserId, 'TEST_ACTION', 'test', 1, 'test detail');

        const log = mockDb.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').get('TEST_ACTION');
        const createdAt = new Date(log.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });
});

describe('initializeDatabase - 数据库初始化', () => {
    test('应创建所有必需的表', () => {
        const testDb = new Database(':memory:');
        const originalMockDb = mockDb;
        mockDb = testDb;

        jest.resetModules();
        const { initializeDatabase: initDb } = require('./database');
        initDb();

        const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        const tableNames = tables.map(t => t.name);
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('records');
        expect(tableNames).toContain('user_settings');
        expect(tableNames).toContain('login_logs');
        expect(tableNames).toContain('admin_audit_logs');

        mockDb = originalMockDb;
        testDb.close();
    });

    test('应创建索引', () => {
        const testDb = new Database(':memory:');
        const originalMockDb = mockDb;
        mockDb = testDb;

        jest.resetModules();
        const { initializeDatabase: initDb } = require('./database');
        initDb();

        const indexes = testDb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all();
        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toContain('idx_records_user_id');
        expect(indexNames).toContain('idx_records_date');

        mockDb = originalMockDb;
        testDb.close();
    });
});
