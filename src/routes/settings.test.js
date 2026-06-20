process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

    const express = require('express');
    app = express();
    app.use(express.json());

    const originalGetDb = require('../database').getDb;
    require('../database').getDb = () => db;

    const middleware = require('../middleware');
    const originalAuthenticateToken = middleware.authenticateToken;
    middleware.authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).json({ error: 'Invalid token' });
            req.user = user;
            next();
        });
    };

    const settingsRouter = require('./settings');
    app.use('/api/settings', settingsRouter);

    require('../database').getDb = originalGetDb;
});

afterAll(() => {
    db.close();
});

describe('设置 API - 获取设置', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(401);
    });

    test('无效 token 应返回 403', async () => {
        const res = await request(app).get('/api/settings').set('Authorization', 'Bearer invalid');
        expect(res.status).toBe(403);
    });

    test('用户无设置应返回默认值', async () => {
        const res = await request(app).get('/api/settings').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.hour).toBe(8);
        expect(res.body.minute).toBe(0);
    });

    test('用户有设置应返回存储值', async () => {
        db.prepare('INSERT INTO user_settings (user_id, reminder_hour, reminder_minute) VALUES (?, ?, ?)').run(testUserId, 9, 30);

        const res = await request(app).get('/api/settings').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.hour).toBe(9);
        expect(res.body.minute).toBe(30);

        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(testUserId);
    });
});

describe('设置 API - 保存设置', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(testUserId);
    });

    test('无 token 应返回 401', async () => {
        const res = await request(app).post('/api/settings').send({ hour: 8, minute: 30 });
        expect(res.status).toBe(401);
    });

    test('小时超出范围应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 24, minute: 30 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('小时必须是 0-23 之间的整数');
    });

    test('小时为负数应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: -1, minute: 30 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('小时必须是 0-23 之间的整数');
    });

    test('分钟超出范围应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: 60 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('分钟必须是 0-59 之间的整数');
    });

    test('分钟为负数应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: -1 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('分钟必须是 0-59 之间的整数');
    });

    test('小时为非数字应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 'abc', minute: 30 });
        expect(res.status).toBe(400);
    });

    test('分钟为非数字应返回 400', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 8, minute: 'xyz' });
        expect(res.status).toBe(400);
    });

    test('正常保存应成功', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 9, minute: 30 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reminderTime.hour).toBe(9);
        expect(res.body.reminderTime.minute).toBe(30);

        const row = db.prepare('SELECT reminder_hour, reminder_minute FROM user_settings WHERE user_id = ?').get(testUserId);
        expect(row.reminder_hour).toBe(9);
        expect(row.reminder_minute).toBe(30);
    });

    test('更新现有设置应成功', async () => {
        db.prepare('INSERT INTO user_settings (user_id, reminder_hour, reminder_minute) VALUES (?, ?, ?)').run(testUserId, 8, 0);

        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 10, minute: 15 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const row = db.prepare('SELECT reminder_hour, reminder_minute FROM user_settings WHERE user_id = ?').get(testUserId);
        expect(row.reminder_hour).toBe(10);
        expect(row.reminder_minute).toBe(15);

        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(testUserId);
    });

    test('边界值 0 小时应有效', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 0, minute: 0 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('边界值 23 小时应有效', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 23, minute: 59 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});