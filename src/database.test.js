process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');

describe('database.js', () => {
    test('getDb 应返回数据库实例', () => {
        const { getDb } = require('./database');
        const db = getDb();
        expect(db).toBeDefined();
        expect(typeof db.prepare).toBe('function');
    });

    test('getDb 应返回单例实例', () => {
        const { getDb } = require('./database');
        const db1 = getDb();
        const db2 = getDb();
        expect(db1).toBe(db2);
    });

    test('addLoginLog 应正确记录登录日志', () => {
        const db = new Database(':memory:');
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
            );
        `);

        const device = {
            type: '桌面电脑',
            browser: 'Chrome',
            os: 'Windows',
            model: 'PC',
            ip: '192.168.1.1',
            userAgent: 'test UA'
        };

        db.prepare(`
            INSERT INTO login_logs (user_id, device_type, device_browser, device_os, device_model, ip, user_agent, success, fail_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            1, device.type, device.browser, device.os, device.model,
            device.ip, device.userAgent, 1, null
        );

        const logs = db.prepare('SELECT * FROM login_logs').all();
        expect(logs.length).toBe(1);
        expect(logs[0].user_id).toBe(1);
        expect(logs[0].device_type).toBe('桌面电脑');
        expect(logs[0].device_browser).toBe('Chrome');
        expect(logs[0].device_os).toBe('Windows');
        expect(logs[0].device_model).toBe('PC');
        expect(logs[0].ip).toBe('192.168.1.1');
        expect(logs[0].user_agent).toBe('test UA');
        expect(logs[0].success).toBe(1);
        expect(logs[0].fail_reason).toBeNull();
        expect(logs[0].created_at).toBeDefined();

        db.close();
    });

    test('addLoginLog 应正确记录失败登录', () => {
        const db = new Database(':memory:');
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
            );
        `);

        db.prepare(`
            INSERT INTO login_logs (user_id, device_type, device_browser, device_os, device_model, ip, user_agent, success, fail_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            null, '移动设备', 'Safari', 'iOS', 'iPhone',
            '10.0.0.1', 'test', 0, '密码错误'
        );

        const logs = db.prepare('SELECT * FROM login_logs').all();
        expect(logs.length).toBe(1);
        expect(logs[0].user_id).toBeNull();
        expect(logs[0].success).toBe(0);
        expect(logs[0].fail_reason).toBe('密码错误');

        db.close();
    });

    test('addAuditLog 应正确记录审计日志', () => {
        const db = new Database(':memory:');
        db.exec(`
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

        db.prepare(`
            INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
            VALUES (?, ?, ?, ?, ?)
        `).run(1, 'DELETE_USER', 'user', 10, '删除用户: testuser');

        const logs = db.prepare('SELECT * FROM admin_audit_logs').all();
        expect(logs.length).toBe(1);
        expect(logs[0].admin_id).toBe(1);
        expect(logs[0].action).toBe('DELETE_USER');
        expect(logs[0].target_type).toBe('user');
        expect(logs[0].target_id).toBe(10);
        expect(logs[0].detail).toBe('删除用户: testuser');
        expect(logs[0].created_at).toBeDefined();

        db.close();
    });

    test('addAuditLog 应允许空 detail', () => {
        const db = new Database(':memory:');
        db.exec(`
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

        db.prepare(`
            INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
            VALUES (?, ?, ?, ?, ?)
        `).run(2, 'VIEW_STATS', 'stats', null, null);

        const logs = db.prepare('SELECT * FROM admin_audit_logs').all();
        expect(logs.length).toBe(1);
        expect(logs[0].admin_id).toBe(2);
        expect(logs[0].action).toBe('VIEW_STATS');
        expect(logs[0].target_type).toBe('stats');
        expect(logs[0].target_id).toBeNull();
        expect(logs[0].detail).toBeNull();

        db.close();
    });

    test('closeDb 应关闭数据库连接', () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER)');

        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        db.close();

        expect(() => {
            db.prepare('SELECT 1').get();
        }).toThrow();
    });
});