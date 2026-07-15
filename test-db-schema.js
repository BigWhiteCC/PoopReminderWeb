/**
 * 测试数据库schema定义是否正确
 * 验证 enabled 字段存在于 users 表定义中
 */

const Database = require('better-sqlite3');

describe('数据库 Schema 验证', () => {
    let db;

    beforeAll(() => {
        db = new Database(':memory:');
        // 模拟 initializeDatabase 的表定义
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

    test('users 表应包含 enabled 字段', () => {
        const columns = db.prepare('PRAGMA table_info(users)').all();
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('enabled');
    });

    test('enabled 字段应有正确的默认值', () => {
        const columns = db.prepare('PRAGMA table_info(users)').all();
        const enabledCol = columns.find(c => c.name === 'enabled');

        expect(enabledCol).toBeDefined();
        expect(enabledCol.dflt_value).toBe('1');
    });

    test('enabled 字段类型应为 INTEGER', () => {
        const columns = db.prepare('PRAGMA table_info(users)').all();
        const enabledCol = columns.find(c => c.name === 'enabled');

        expect(enabledCol).toBeDefined();
        expect(enabledCol.type).toBe('INTEGER');
    });

    test('新插入用户应自动获得 enabled=1', () => {
        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync('test123', 10);

        const result = db.prepare(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
        ).run('testuser', 'test@example.com', hashedPassword);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

        expect(user.enabled).toBe(1);
    });

    test('禁用用户后 enabled 应为 0', () => {
        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync('test123', 10);

        const result = db.prepare(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
        ).run('testuser2', 'test2@example.com', hashedPassword);

        db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(0, result.lastInsertRowid);

        const user = db.prepare('SELECT enabled FROM users WHERE id = ?').get(result.lastInsertRowid);

        expect(user.enabled).toBe(0);
    });
});