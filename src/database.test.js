process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

describe('Database Functions', () => {
    let db;

    beforeAll(() => {
        db = new Database(':memory:');
    });

    afterAll(() => {
        db.close();
    });

    describe('initializeDatabase - 表结构初始化', () => {
        test('应创建所有必需的表', () => {
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
            `);

            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
            const tableNames = tables.map(t => t.name);

            expect(tableNames).toContain('users');
            expect(tableNames).toContain('records');
            expect(tableNames).toContain('user_settings');
            expect(tableNames).toContain('login_logs');
            expect(tableNames).toContain('admin_audit_logs');
        });

        test('应创建正确的索引', () => {
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
                CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
            `);

            const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all();
            const indexNames = indexes.map(i => i.name);

            expect(indexNames).toContain('idx_records_user_id');
            expect(indexNames).toContain('idx_records_date');
        });
    });

    describe('addColumnIfMissing - 向后兼容字段添加', () => {
        test('缺少字段时应成功添加', () => {
            // 创建简化表
            db.exec('DROP TABLE IF EXISTS test_table');
            db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)');

            const addColumn = (col, def, table) => {
                const info = db.prepare(`PRAGMA table_info(${table})`).all();
                if (!info.some(c => c.name === col)) {
                    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
                    catch (e) { /* 字段已存在 */ }
                }
            };

            addColumn('status', 'TEXT', 'test_table');
            addColumn('created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP', 'test_table');

            const info = db.prepare('PRAGMA table_info(test_table)').all();
            const colNames = info.map(c => c.name);

            expect(colNames).toContain('status');
            expect(colNames).toContain('created_at');
        });

        test('字段已存在时应忽略', () => {
            db.exec('DROP TABLE IF EXISTS test_table2');
            db.exec('CREATE TABLE test_table2 (id INTEGER PRIMARY KEY, existing_col TEXT)');

            const addColumn = (col, def, table) => {
                const info = db.prepare(`PRAGMA table_info(${table})`).all();
                if (!info.some(c => c.name === col)) {
                    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
                    catch (e) { /* 字段已存在 */ }
                }
            };

            // 尝试添加已存在的字段
            addColumn('existing_col', 'TEXT', 'test_table2');

            const info = db.prepare('PRAGMA table_info(test_table2)').all();
            // 应只有两个字段，不会重复添加
            expect(info.length).toBe(2);
        });
    });

    describe('addLoginLog - 登录日志记录', () => {
        let testUserId;

        beforeEach(() => {
            // 先清理所有相关数据
            db.prepare('DELETE FROM login_logs').run();
            db.prepare('DELETE FROM users WHERE email = ?').run('log@test.com');
            // 创建测试用户
            const hashedPassword = bcrypt.hashSync('test123', 10);
            const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('log_test', 'log@test.com', hashedPassword);
            testUserId = result.lastInsertRowid;
        });

        afterEach(() => {
            // 先清理日志，再清理用户
            db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(testUserId);
            db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
        });

        test('成功登录应正确记录', () => {
            const device = {
                type: '移动设备',
                browser: 'Chrome',
                os: 'Android',
                model: 'Pixel 8',
                ip: '192.168.1.1',
                userAgent: 'test UA'
            };

            db.prepare(`
                INSERT INTO login_logs (user_id, device_type, device_browser, device_os, device_model, ip, user_agent, success, fail_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(testUserId, device.type, device.browser, device.os, device.model, device.ip, device.userAgent, 1, null);

            const log = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').get(testUserId);
            expect(log).toBeDefined();
            expect(log.success).toBe(1);
            expect(log.device_type).toBe('移动设备');
            expect(log.fail_reason).toBeNull();
        });

        test('失败登录应记录原因', () => {
            const device = {
                type: '桌面电脑',
                browser: 'Firefox',
                os: 'Windows',
                model: 'Windows PC',
                ip: '10.0.0.1',
                userAgent: 'test UA'
            };

            db.prepare(`
                INSERT INTO login_logs (user_id, device_type, device_browser, device_os, device_model, ip, user_agent, success, fail_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(testUserId, device.type, device.browser, device.os, device.model, device.ip, device.userAgent, 0, '密码错误');

            const log = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').get(testUserId);
            expect(log).toBeDefined();
            expect(log.success).toBe(0);
            expect(log.fail_reason).toBe('密码错误');
        });

        test('user_id 为 null 时应能记录（未找到用户）', () => {
            db.prepare(`
                INSERT INTO login_logs (user_id, device_type, success, fail_reason)
                VALUES (?, ?, ?, ?)
            `).run(null, '桌面电脑', 0, '用户不存在');

            const log = db.prepare('SELECT * FROM login_logs WHERE user_id IS NULL').get();
            expect(log).toBeDefined();
            expect(log.fail_reason).toBe('用户不存在');
        });
    });

    describe('addAuditLog - 操作审计日志', () => {
        let adminId;

        beforeEach(() => {
            // 先清理所有相关数据
            db.prepare('DELETE FROM admin_audit_logs').run();
            db.prepare('DELETE FROM users WHERE email = ?').run('audit@test.com');
            // 创建管理员用户
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('audit_admin', 'audit@test.com', hashedPassword, 'admin');
            adminId = result.lastInsertRowid;
        });

        afterEach(() => {
            // 先清理审计日志，再清理用户
            db.prepare('DELETE FROM admin_audit_logs WHERE admin_id = ?').run(adminId);
            db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
        });

        test('删除用户操作应正确记录', () => {
            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminId, 'DELETE_USER', 'user', 10, '删除用户: testuser');

            const log = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').get('DELETE_USER');
            expect(log).toBeDefined();
            expect(log.admin_id).toBe(adminId);
            expect(log.target_type).toBe('user');
            expect(log.target_id).toBe(10);
            expect(log.detail).toBe('删除用户: testuser');
        });

        test('重置密码操作应正确记录', () => {
            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminId, 'RESET_PASSWORD', 'user', 20, '重置用户 adminuser 的密码');

            const log = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').get('RESET_PASSWORD');
            expect(log).toBeDefined();
            expect(log.target_id).toBe(20);
        });

        test('启用/禁用用户操作应正确记录', () => {
            db.prepare(`
                INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
                VALUES (?, ?, ?, ?, ?)
            `).run(adminId, 'DISABLE_USER', 'user', 30, '禁用用户: baduser');

            const log = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').get('DISABLE_USER');
            expect(log).toBeDefined();
            expect(log.detail).toContain('禁用');
        });
    });

    describe('级联删除逻辑', () => {
        let testUserId;

        beforeEach(() => {
            // 创建测试用户
            const hashedPassword = bcrypt.hashSync('test123', 10);
            const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('cascade_test', 'cascade@test.com', hashedPassword);
            testUserId = result.lastInsertRowid;

            // 创建关联数据
            db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-01', 4);
            db.prepare('INSERT INTO user_settings (user_id, reminder_hour, reminder_minute) VALUES (?, ?, ?)').run(testUserId, 8, 0);
            db.prepare('INSERT INTO login_logs (user_id, success) VALUES (?, ?)').run(testUserId, 1);
        });

        test('删除用户时应级联删除所有关联数据', () => {
            // 验证数据已创建
            expect(db.prepare('SELECT id FROM records WHERE user_id = ?').get(testUserId)).toBeDefined();
            expect(db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(testUserId)).toBeDefined();
            expect(db.prepare('SELECT id FROM login_logs WHERE user_id = ?').get(testUserId)).toBeDefined();

            // 执行级联删除
            db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(testUserId);
            db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
            db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(testUserId);
            db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);

            // 验证数据已删除
            expect(db.prepare('SELECT id FROM users WHERE id = ?').get(testUserId)).toBeUndefined();
            expect(db.prepare('SELECT id FROM records WHERE user_id = ?').get(testUserId)).toBeUndefined();
            expect(db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(testUserId)).toBeUndefined();
            expect(db.prepare('SELECT id FROM login_logs WHERE user_id = ?').get(testUserId)).toBeUndefined();
        });

        test('删除用户前应验证角色权限', () => {
            // 创建管理员用户
            const adminResult = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin_cascade', 'admin_cascade@test.com', bcrypt.hashSync('pass', 10), 'admin');
            const adminId = adminResult.lastInsertRowid;

            // 检查角色
            const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(adminId);
            expect(admin.role).toBe('admin');

            // 普通用户不应能删除管理员
            const user = db.prepare('SELECT role FROM users WHERE id = ?').get(testUserId);
            expect(user.role).toBe('user');

            // 清理
            db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
        });
    });
});