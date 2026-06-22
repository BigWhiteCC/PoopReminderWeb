const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const TEST_DB_PATH = ':memory:';
const JWT_SECRET = 'test-secret-key';

let app;
let db;
let testUserId;
let testToken;

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
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            reminder_hour INTEGER DEFAULT 8,
            reminder_minute INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = db.prepare('INSERT INTO users (username, email, password, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)').run(
        'testuser', 'test@test.com', hashedPassword, new Date().toISOString(), new Date().toISOString()
    );
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

    const express = require('express');
    app = express();
    app.use(express.json());

    jest.resetModules();
    jest.doMock('../database', () => ({
        getDb: jest.fn(() => db)
    }));

    const router = require('./settings');
    app.use('/api/settings', router);
});

afterAll(() => {
    jest.restoreAllMocks();
    db.close();
});

describe('设置 API - 获取提醒时间', () => {
    test('无设置记录应返回默认值', async () => {
        const res = await request(app).get('/api/settings')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.hour).toBe(8);
        expect(res.body.minute).toBe(0);
    });

    test('有设置记录应返回保存的值', async () => {
        db.prepare('INSERT INTO user_settings (user_id, reminder_hour, reminder_minute) VALUES (?, ?, ?)').run(testUserId, 9, 30);

        const res = await request(app).get('/api/settings')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.hour).toBe(9);
        expect(res.body.minute).toBe(30);

        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(testUserId);
    });

    test('无认证应返回 401', async () => {
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(401);
    });
});

describe('设置 API - 保存提醒时间', () => {
    test('有效时间应保存成功', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 10, minute: 30 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reminderTime.hour).toBe(10);
        expect(res.body.reminderTime.minute).toBe(30);

        const row = db.prepare('SELECT reminder_hour, reminder_minute FROM user_settings WHERE user_id = ?').get(testUserId);
        expect(row.reminder_hour).toBe(10);
        expect(row.reminder_minute).toBe(30);
    });

    test('无效小时应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 24, minute: 0 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('小时');
    });

    test('无效分钟应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: 60 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('分钟');
    });

    test('负数小时应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: -1, minute: 0 });
        expect(res.status).toBe(400);
    });

    test('负数分钟应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: -1 });
        expect(res.status).toBe(400);
    });

    test('非数字小时应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 'invalid', minute: 0 });
        expect(res.status).toBe(400);
    });

    test('非数字分钟应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: 'invalid' });
        expect(res.status).toBe(400);
    });

    test('边界值应正常保存', async () => {
        const res1 = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 0, minute: 0 });
        expect(res1.status).toBe(200);

        const res2 = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 23, minute: 59 });
        expect(res2.status).toBe(200);
    });

    test('无认证应返回 401', async () => {
        const res = await request(app).post('/api/settings')
            .send({ hour: 8, minute: 0 });
        expect(res.status).toBe(401);
    });

    test('重复保存应更新现有记录', async () => {
        await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: 0 });
        await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 12, minute: 30 });

        const row = db.prepare('SELECT reminder_hour, reminder_minute FROM user_settings WHERE user_id = ?').get(testUserId);
        expect(row.reminder_hour).toBe(12);
        expect(row.reminder_minute).toBe(30);
    });
});