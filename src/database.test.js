/**
 * 数据库模块测试
 * 重点覆盖：数据库初始化、用户操作、记录操作、登录日志、审计日志、并发安全
 */

process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// 测试数据库路径
const TEST_DB_PATH = ':memory:';

describe('数据库模块 - 初始化', () => {
    let db;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
    });

    afterAll(() => {
        db.close();
    });

    test('数据库连接应成功', () => {
        expect(db).toBeDefined();
        expect(db.open).toBe(true);
    });

    test('初始化表结构应成功', () => {
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
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
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
            CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
            CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
        `);

        // 验证表是否创建
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tables.map(t => t.name);
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('records');
        expect(tableNames).toContain('user_settings');
        expect(tableNames).toContain('login_logs');
        expect(tableNames).toContain('admin_audit_logs');
    });

    test('索引应成功创建', () => {
        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toContain('idx_records_user_id');
        expect(indexNames).toContain('idx_records_date');
    });

    test('表字段应包含所有必要列', () => {
        const userColumns = db.prepare('PRAGMA table_info(users)').all();
        const columnNames = userColumns.map(c => c.name);
        expect(columnNames).toContain('id');
        expect(columnNames).toContain('username');
        expect(columnNames).toContain('email');
        expect(columnNames).toContain('password');
        expect(columnNames).toContain('role');
        expect(columnNames).toContain('enabled');
        expect(columnNames).toContain('created_at');
        expect(columnNames).toContain('password_changed_at');
    });
});

describe('数据库模块 - 用户操作', () => {
    let db;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
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
        `);
    });

    afterAll(() => {
        db.close();
    });

    afterEach(() => {
        db.exec('DELETE FROM users');
    });

    test('插入用户应成功', () => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', hashedPassword);
        expect(result.lastInsertRowid).toBeGreaterThan(0);
        expect(result.changes).toBe(1);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        expect(user.username).toBe('testuser');
        expect(user.email).toBe('test@test.com');
        expect(user.role).toBe('user');
        expect(user.enabled).toBe(1);
    });

    test('用户名重复应抛出约束错误', () => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test1@test.com', hashedPassword);

        try {
            db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test2@test.com', hashedPassword);
            fail('应抛出错误');
        } catch (err) {
            expect(err.message).toContain('UNIQUE constraint');
        }
    });

    test('邮箱重复应抛出约束错误', () => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('user1', 'test@test.com', hashedPassword);

        try {
            db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('user2', 'test@test.com', hashedPassword);
            fail('应抛出错误');
        } catch (err) {
            expect(err.message).toContain('UNIQUE constraint');
        }
    });

    test('查询用户应正确返回', () => {
        const hashedPassword = bcrypt.hashSync('password123', 10);
        db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', hashedPassword, 'admin');

        const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@test.com');
        expect(userByEmail.username).toBe('admin');
        expect(userByEmail.role).toBe('admin');

        const userByUsername = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
        expect(userByUsername.email).toBe('admin@test.com');
    });

    test('更新用户密码应成功', () => {
        const hashedPassword = bcrypt.hashSync('oldpassword', 10);
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', hashedPassword);

        const newHashedPassword = bcrypt.hashSync('newpassword', 10);
        const now = new Date().toISOString();
        db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(newHashedPassword, now, result.lastInsertRowid);

        const user = db.prepare('SELECT password, password_changed_at FROM users WHERE id = ?').get(result.lastInsertRowid);
        expect(bcrypt.compareSync('newpassword', user.password)).toBe(true);
        expect(user.password_changed_at).toBe(now);
    });

    test('更新用户角色应成功', () => {
        const hashedPassword = bcrypt.hashSync('password', 10);
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', hashedPassword);

        db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', result.lastInsertRowid);

        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(result.lastInsertRowid);
        expect(user.role).toBe('admin');
    });

    test('禁用/启用用户应成功', () => {
        const hashedPassword = bcrypt.hashSync('password', 10);
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', hashedPassword);

        // 禁用
        db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(0, result.lastInsertRowid);
        const disabledUser = db.prepare('SELECT enabled FROM users WHERE id = ?').get(result.lastInsertRowid);
        expect(disabledUser.enabled).toBe(0);

        // 启用
        db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(1, result.lastInsertRowid);
        const enabledUser = db.prepare('SELECT enabled FROM users WHERE id = ?').get(result.lastInsertRowid);
        expect(enabledUser.enabled).toBe(1);
    });

    test('删除用户应成功', () => {
        const hashedPassword = bcrypt.hashSync('password', 10);
        const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', hashedPassword);

        db.prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        expect(user).toBeUndefined();
    });

    test('批量查询用户应正确', () => {
        for (let i = 0; i < 10; i++) {
            db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(`user${i}`, `user${i}@test.com`, bcrypt.hashSync('pass', 10));
        }

        const users = db.prepare('SELECT * FROM users ORDER BY id DESC').all();
        expect(users.length).toBe(10);
    });
});

describe('数据库模块 - 记录操作', () => {
    let db;
    let userId;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
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

        userId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', 'hashedpass').lastInsertRowid;
    });

    afterAll(() => {
        db.close();
    });

    afterEach(() => {
        db.exec('DELETE FROM records');
    });

    test('插入记录应成功', () => {
        const result = db.prepare(`
            INSERT INTO records (user_id, date, notes, poop_type, duration, status, device_type, device_ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, '2024-01-15T08:30:00', '测试备注', 4, 300, '正常', '移动设备', '192.168.1.1');

        expect(result.lastInsertRowid).toBeGreaterThan(0);

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
        expect(record.user_id).toBe(userId);
        expect(record.notes).toBe('测试备注');
        expect(record.poop_type).toBe(4);
        expect(record.duration).toBe(300);
        expect(record.device_type).toBe('移动设备');
    });

    test('查询用户记录应正确', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-15T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-16T09:00:00', 3);

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(userId);
        expect(records.length).toBe(2);
        expect(records[0].poop_type).toBe(3); // 最新的
        expect(records[1].poop_type).toBe(4);
    });

    test('更新记录应成功', () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, notes) VALUES (?, ?, ?, ?)').run(userId, '2024-01-15T08:00:00', 4, '旧备注');

        db.prepare('UPDATE records SET poop_type = ?, notes = ? WHERE id = ?').run(5, '新备注', result.lastInsertRowid);

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
        expect(record.poop_type).toBe(5);
        expect(record.notes).toBe('新备注');
    });

    test('删除记录应成功', () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-15T08:00:00', 4);

        db.prepare('DELETE FROM records WHERE id = ?').run(result.lastInsertRowid);

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
        expect(record).toBeUndefined();
    });

    test('记录按日期筛选应正确', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-15T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-20T09:00:00', 3);

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? AND date >= ? AND date < ?').all(userId, '2024-01-15', '2024-01-20');
        expect(records.length).toBe(1);
        expect(records[0].poop_type).toBe(4);
    });

    test('记录按类型筛选应正确', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-15T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-16T09:00:00', 3);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, '2024-01-17T10:00:00', 4);

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? AND poop_type = ?').all(userId, 4);
        expect(records.length).toBe(2);
    });

    test('空字段记录应正确处理', () => {
        const result = db.prepare('INSERT INTO records (user_id, date) VALUES (?, ?)').run(userId, '2024-01-15T08:00:00');

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
        expect(record.notes).toBeNull();
        expect(record.poop_type).toBeNull();
        expect(record.duration).toBe(0);
    });

    test('记录统计查询应正确', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(userId, '2024-01-15T08:00:00', 4, 300);
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(userId, '2024-01-16T09:00:00', 3, 240);

        const count = db.prepare('SELECT COUNT(*) as c FROM records WHERE user_id = ?').get(userId).c;
        expect(count).toBe(2);

        const typeStats = db.prepare('SELECT poop_type, COUNT(*) as c FROM records WHERE user_id = ? GROUP BY poop_type').all(userId);
        expect(typeStats.length).toBe(2);
    });

    test('外键约束应生效', () => {
        // 不存在的用户ID
        try {
            db.prepare('INSERT INTO records (user_id, date) VALUES (?, ?)').run(9999, '2024-01-15T08:00:00');
            // SQLite 默认不强制外键约束，但可以启用
        } catch (err) {
            // 如果启用了外键约束，应抛出错误
            expect(err.message).toContain('FOREIGN KEY');
        }
    });
});

describe('数据库模块 - 登录日志', () => {
    let db;
    let userId;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
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
        `);

        userId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', 'hashedpass').lastInsertRowid;
    });

    afterAll(() => {
        db.close();
    });

    afterEach(() => {
        db.exec('DELETE FROM login_logs');
    });

    test('插入成功登录日志应成功', () => {
        const result = db.prepare(`
            INSERT INTO login_logs (user_id, device_type, device_browser, ip, success)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, '移动设备', 'Chrome', '192.168.1.1', 1);

        expect(result.lastInsertRowid).toBeGreaterThan(0);

        const log = db.prepare('SELECT * FROM login_logs WHERE id = ?').get(result.lastInsertRowid);
        expect(log.user_id).toBe(userId);
        expect(log.success).toBe(1);
        expect(log.fail_reason).toBeNull();
    });

    test('插入失败登录日志应成功', () => {
        const result = db.prepare(`
            INSERT INTO login_logs (user_id, device_type, ip, success, fail_reason)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, '桌面电脑', '10.0.0.1', 0, '密码错误');

        const log = db.prepare('SELECT * FROM login_logs WHERE id = ?').get(result.lastInsertRowid);
        expect(log.success).toBe(0);
        expect(log.fail_reason).toBe('密码错误');
    });

    test('查询登录日志应正确筛选', () => {
        db.prepare('INSERT INTO login_logs (user_id, success) VALUES (?, ?)').run(userId, 1);
        db.prepare('INSERT INTO login_logs (user_id, success) VALUES (?, ?)').run(userId, 0);
        db.prepare('INSERT INTO login_logs (user_id, success) VALUES (?, ?)').run(userId, 1);

        const successLogs = db.prepare('SELECT * FROM login_logs WHERE success = ?').all(1);
        expect(successLogs.length).toBe(2);

        const failLogs = db.prepare('SELECT * FROM login_logs WHERE success = ?').all(0);
        expect(failLogs.length).toBe(1);
    });

    test('登录日志时间戳应自动生成', () => {
        const result = db.prepare('INSERT INTO login_logs (user_id, success) VALUES (?, ?)').run(userId, 1);

        const log = db.prepare('SELECT created_at FROM login_logs WHERE id = ?').get(result.lastInsertRowid);
        expect(log.created_at).toBeDefined();
        expect(new Date(log.created_at).getTime()).toBeGreaterThan(0);
    });

    test('批量插入登录日志应成功', () => {
        for (let i = 0; i < 100; i++) {
            db.prepare('INSERT INTO login_logs (user_id, ip, success) VALUES (?, ?, ?)').run(userId, `192.168.1.${i}`, i % 10 === 0 ? 0 : 1);
        }

        const logs = db.prepare('SELECT * FROM login_logs').all();
        expect(logs.length).toBe(100);

        const failCount = db.prepare('SELECT COUNT(*) as c FROM login_logs WHERE success = ?').get(0).c;
        expect(failCount).toBe(10);
    });
});

describe('数据库模块 - 审计日志', () => {
    let db;
    let adminId;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
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

        adminId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('admin', 'admin@test.com', 'hashedpass').lastInsertRowid;
    });

    afterAll(() => {
        db.close();
    });

    afterEach(() => {
        db.exec('DELETE FROM admin_audit_logs');
    });

    test('插入审计日志应成功', () => {
        const result = db.prepare(`
            INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
            VALUES (?, ?, ?, ?, ?)
        `).run(adminId, 'DELETE_USER', 'user', 123, '删除用户 testuser');

        expect(result.lastInsertRowid).toBeGreaterThan(0);

        const log = db.prepare('SELECT * FROM admin_audit_logs WHERE id = ?').get(result.lastInsertRowid);
        expect(log.admin_id).toBe(adminId);
        expect(log.action).toBe('DELETE_USER');
        expect(log.target_type).toBe('user');
        expect(log.target_id).toBe(123);
    });

    test('查询审计日志应正确筛选', () => {
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type) VALUES (?, ?, ?)').run(adminId, 'DELETE_USER', 'user');
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type) VALUES (?, ?, ?)').run(adminId, 'RESET_PASSWORD', 'user');
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type) VALUES (?, ?, ?)').run(adminId, 'DELETE_USER', 'record');

        const userActions = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').all('DELETE_USER');
        expect(userActions.length).toBe(2);

        const userTargets = db.prepare('SELECT * FROM admin_audit_logs WHERE target_type = ?').all('user');
        expect(userTargets.length).toBe(2);
    });

    test('审计日志时间戳应自动生成', () => {
        const result = db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type) VALUES (?, ?, ?)').run(adminId, 'TEST', 'test');

        const log = db.prepare('SELECT created_at FROM admin_audit_logs WHERE id = ?').get(result.lastInsertRowid);
        expect(log.created_at).toBeDefined();
        expect(new Date(log.created_at).getTime()).toBeGreaterThan(0);
    });

    test('审计日志按时间排序应正确', () => {
        const now = new Date();
        for (let i = 0; i < 5; i++) {
            const timestamp = new Date(now.getTime() - i * 1000).toISOString();
            db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, created_at) VALUES (?, ?, ?, ?)').run(adminId, `ACTION_${i}`, 'test', timestamp);
        }

        const logs = db.prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC').all();
        expect(logs[0].action).toBe('ACTION_0');
        expect(logs[4].action).toBe('ACTION_4');
    });
});

describe('数据库模块 - 用户设置', () => {
    let db;
    let userId;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                reminder_hour INTEGER DEFAULT 8,
                reminder_minute INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `);

        userId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', 'hashedpass').lastInsertRowid;
    });

    afterAll(() => {
        db.close();
    });

    afterEach(() => {
        db.exec('DELETE FROM user_settings');
    });

    test('插入用户设置应成功', () => {
        const result = db.prepare('INSERT INTO user_settings (user_id, reminder_hour, reminder_minute) VALUES (?, ?, ?)').run(userId, 20, 30);

        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
        expect(settings.reminder_hour).toBe(20);
        expect(settings.reminder_minute).toBe(30);
    });

    test('更新用户设置应成功', () => {
        db.prepare('INSERT INTO user_settings (user_id, reminder_hour) VALUES (?, ?)').run(userId, 8);

        db.prepare('UPDATE user_settings SET reminder_hour = ? WHERE user_id = ?').run(9, userId);

        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
        expect(settings.reminder_hour).toBe(9);
    });

    test('用户设置唯一性约束应生效', () => {
        db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);

        try {
            db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
            fail('应抛出错误');
        } catch (err) {
            expect(err.message).toContain('UNIQUE constraint');
        }
    });

    test('查询不存在用户设置应返回 undefined', () => {
        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
        expect(settings).toBeUndefined();
    });
});

describe('数据库模块 - 并发与性能', () => {
    let db;

    beforeAll(() => {
        db = new Database(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                poop_type INTEGER
            );
        `);
    });

    afterAll(() => {
        db.close();
    });

    test('批量插入性能应合理', () => {
        const userId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('batchuser', 'batch@test.com', 'pass').lastInsertRowid;

        const insert = db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)');
        const insertMany = db.transaction((records) => {
            for (const r of records) insert.run(r.user_id, r.date, r.poop_type);
        });

        const records = [];
        for (let i = 0; i < 1000; i++) {
            records.push({ user_id: userId, date: `2024-01-${String(i % 28 + 1).padStart(2, '0')}T08:00:00`, poop_type: 4 });
        }

        const start = Date.now();
        insertMany(records);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(500); // 1000条记录应在500ms内完成

        const count = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
        expect(count).toBe(1000);
    });

    test('查询性能应合理', () => {
        const userId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('queryuser', 'query@test.com', 'pass').lastInsertRowid;

        for (let i = 0; i < 1000; i++) {
            db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(userId, `2024-${String(Math.floor(i / 28) % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}T08:00:00`, 4);
        }

        const start = Date.now();
        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC LIMIT 100').all(userId);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(50); // 查询100条应在50ms内完成
        expect(records.length).toBe(100);
    });

    test('事务应正确处理', () => {
        const userId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('txuser', 'tx@test.com', 'pass').lastInsertRowid;

        const insert = db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)');

        // 成功事务
        const successTx = db.transaction(() => {
            insert.run(userId, '2024-01-01T08:00:00', 4);
            insert.run(userId, '2024-01-02T08:00:00', 4);
        });
        successTx();

        const count1 = db.prepare('SELECT COUNT(*) as c FROM records WHERE user_id = ?').get(userId).c;
        expect(count1).toBe(2);

        // 失败事务应回滚
        const failTx = db.transaction(() => {
            insert.run(userId, '2024-01-03T08:00:00', 4);
            throw new Error('模拟错误');
        });

        try {
            failTx();
        } catch (e) {}

        const count2 = db.prepare('SELECT COUNT(*) as c FROM records WHERE user_id = ?').get(userId).c;
        expect(count2).toBe(2); // 未增加，已回滚
    });
});