const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const TEST_DB_PATH = ':memory:';
const JWT_SECRET = 'test-secret-key';

let app;
let db;
let testUserId;

const createTestApp = () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    jest.resetModules();
    jest.doMock('./database', () => ({
        getDb: jest.fn(() => db)
    }));

    const { authenticateToken, handleError } = require('./middleware');

    app.get('/api/protected', authenticateToken, (req, res) => {
        res.json({ success: true, userId: req.user.userId });
    });

    app.post('/api/change-password', authenticateToken, async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        try {
            const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);
            if (!user) return res.status(404).json({ error: '用户不存在' });
            const valid = bcrypt.compareSync(oldPassword, user.password);
            if (!valid) return res.status(400).json({ error: '旧密码错误' });
            const hashedPassword = bcrypt.hashSync(newPassword, 10);
            const now = new Date().toISOString();
            db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(hashedPassword, now, req.user.userId);
            res.json({ success: true, message: '密码修改成功' });
        } catch (err) {
            const e = handleError(err, 'changePassword');
            res.status(e.status).json({ error: e.message });
        }
    });

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
    `);
});

afterAll(() => {
    jest.restoreAllMocks();
    db.close();
});

describe('密码修改后 Token 失效机制', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM users').run();
        app = createTestApp();
    });

    test('修改密码后旧Token应失效', async () => {
        const hashedPassword = bcrypt.hashSync('test123', 10);
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO users (username, email, password, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)').run(
            'testuser', 'test@test.com', hashedPassword, now, now
        );
        testUserId = result.lastInsertRowid;

        const oldToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

        await new Promise(resolve => setTimeout(resolve, 2000));

        await request(app).post('/api/change-password')
            .set('Authorization', `Bearer ${oldToken}`)
            .send({ oldPassword: 'test123', newPassword: 'newpassword123' });

        const res = await request(app).get('/api/protected')
            .set('Authorization', `Bearer ${oldToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Token expired due to password change');
    });

    test('修改密码后新Token应有效', async () => {
        const hashedPassword = bcrypt.hashSync('test123', 10);
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO users (username, email, password, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)').run(
            'testuser', 'test@test.com', hashedPassword, now, now
        );
        testUserId = result.lastInsertRowid;

        const oldToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

        await request(app).post('/api/change-password')
            .set('Authorization', `Bearer ${oldToken}`)
            .send({ oldPassword: 'test123', newPassword: 'newpassword123' });

        const newToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

        const res = await request(app).get('/api/protected')
            .set('Authorization', `Bearer ${newToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('从未修改过密码的用户Token应始终有效', async () => {
        const hashedPassword = bcrypt.hashSync('test123', 10);
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO users (username, email, password, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)').run(
            'newuser', 'new@test.com', hashedPassword, now, now
        );
        const newUserId = result.lastInsertRowid;
        const token = jwt.sign({ userId: newUserId, username: 'newuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

        const res = await request(app).get('/api/protected')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('不存在的用户Token应返回403', async () => {
        const token = jwt.sign({ userId: 99999, username: 'nonexistent', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

        const res = await request(app).get('/api/protected')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('User not found');
    });

    test('密码修改时间与Token签发时间相同时应允许访问', async () => {
        const hashedPassword = bcrypt.hashSync('test123', 10);
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO users (username, email, password, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)').run(
            'sameuser', 'same@test.com', hashedPassword, now, now
        );
        const sameUserId = result.lastInsertRowid;

        const token = jwt.sign({ userId: sameUserId, username: 'sameuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

        const res = await request(app).get('/api/protected')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});