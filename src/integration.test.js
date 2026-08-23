/**
 * 集成测试：真实中间件 + 真实路由 + 内存数据库
 * 覆盖两个关键缺陷的回归：
 * 1. 被禁用用户的 access token / refresh token 必须立即失效（安全）
 * 2. 管理端记录列表 end 日期筛选必须包含结束日当天的记录（数据完整性）
 */

process.env.JWT_SECRET = 'test-secret-key';
process.env.DB_PATH = ':memory:';

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, initializeDatabase, closeDb } = require('./database');
const { authenticateToken } = require('./middleware');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');

const JWT_SECRET = 'test-secret-key';

let app;
let db;
let victimUserId;
let victimAccessToken;
let victimRefreshToken;
let adminAccessToken;
let normalUserId;
let normalAccessToken;

function signAccess(user) {
    return jwt.sign(
        { userId: user.id, username: user.username, role: user.role || 'user' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function signRefresh(user) {
    return jwt.sign(
        { userId: user.id, username: user.username, role: user.role || 'user', type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

beforeAll(() => {
    initializeDatabase();
    db = getDb();

    const insertUser = db.prepare(
        'INSERT INTO users (username, email, password, role, enabled) VALUES (?, ?, ?, ?, 1)'
    );

    victimUserId = insertUser.run('victim', 'victim@test.com', bcrypt.hashSync('pass123', 4), 'user').lastInsertRowid;
    normalUserId = insertUser.run('normal', 'normal@test.com', bcrypt.hashSync('pass123', 4), 'user').lastInsertRowid;
    const adminId = insertUser.run('admin', 'admin@test.com', bcrypt.hashSync('pass123', 4), 'admin').lastInsertRowid;

    victimAccessToken = signAccess({ id: victimUserId, username: 'victim', role: 'user' });
    victimRefreshToken = signRefresh({ id: victimUserId, username: 'victim', role: 'user' });
    normalAccessToken = signAccess({ id: normalUserId, username: 'normal', role: 'user' });
    adminAccessToken = signAccess({ id: adminId, username: 'admin', role: 'admin' });

    app = express();
    app.use(express.json());
    app.use('/api', authRouter);
    app.use('/api/admin', adminRouter);
});

afterAll(() => {
    closeDb();
});

describe('禁用用户必须立即失去访问权限', () => {
    test('启用用户的 access token 正常工作', async () => {
        const res = await request(app)
            .get('/api/user')
            .set('Authorization', `Bearer ${normalAccessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('normal');
    });

    test('启用用户的 refresh token 可以换新 access token', async () => {
        const res = await request(app)
            .post('/api/refresh')
            .send({ refreshToken: signRefresh({ id: normalUserId, username: 'normal', role: 'user' }) });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
    });

    test('禁用后 access token 立即被拒绝（401 账号已被禁用）', async () => {
        db.prepare('UPDATE users SET enabled = 0 WHERE id = ?').run(victimUserId);

        const res = await request(app)
            .get('/api/user')
            .set('Authorization', `Bearer ${victimAccessToken}`);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('账号已被禁用');
    });

    test('禁用后 refresh token 无法续期，不能绕过封禁', async () => {
        const res = await request(app)
            .post('/api/refresh')
            .send({ refreshToken: victimRefreshToken });
        expect(res.status).toBe(401);
        expect(res.body.token).toBeUndefined();
    });

    test('重新启用后 token 恢复有效', async () => {
        db.prepare('UPDATE users SET enabled = 1 WHERE id = ?').run(victimUserId);

        const res = await request(app)
            .get('/api/user')
            .set('Authorization', `Bearer ${victimAccessToken}`);
        expect(res.status).toBe(200);
    });
});

describe('管理端记录列表 end 日期筛选包含结束日当天', () => {
    const DAY1 = '2026-08-22T10:00:00.000Z';
    const DAY2 = '2026-08-23T15:30:00.000Z';

    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(normalUserId);
        const ins = db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)');
        ins.run(normalUserId, DAY1, 4, 300);
        ins.run(normalUserId, DAY2, 5, 480);
    });

    test('end=结束日 应返回结束日当天的记录', async () => {
        const res = await request(app)
            .get('/api/admin/records?end=2026-08-23')
            .set('Authorization', `Bearer ${adminAccessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.total).toBe(2);
        expect(res.body.records.some(r => r.date === DAY2)).toBe(true);
    });

    test('end=前一天 不应包含次日的记录', async () => {
        const res = await request(app)
            .get('/api/admin/records?end=2026-08-22')
            .set('Authorization', `Bearer ${adminAccessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.total).toBe(1);
        expect(res.body.records[0].date).toBe(DAY1);
    });

    test('start 与 end 同日 应精确返回当天记录', async () => {
        const res = await request(app)
            .get('/api/admin/records?start=2026-08-23&end=2026-08-23')
            .set('Authorization', `Bearer ${adminAccessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.total).toBe(1);
        expect(res.body.records[0].date).toBe(DAY2);
    });
});
