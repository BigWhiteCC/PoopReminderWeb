/**
 * 实际 src/middleware.js 鉴权函数的单元测试
 * 重点覆盖：authenticateToken 的 password_changed_at 安全检查（密码修改后旧 token 失效）、
 * requireAdmin 的角色门控。
 *
 * 通过 jest.mock 替换 ./database 与 ./config 注入测试数据库与固定密钥。
 */

const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const mockDb = new Database(':memory:');
mockDb.exec(`
    CREATE TABLE users (
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

jest.mock('../src/database', () => ({
    getDb: () => mockDb,
    addLoginLog: jest.fn(),
    addAuditLog: jest.fn()
}));

jest.mock('../src/config', () => ({
    JWT_SECRET: 'middleware-test-secret',
    JWT_EXPIRES_IN: '7d',
    IS_PROD: false,
    IS_DEV: true,
    POOP_TYPES: []
}));

const { authenticateToken, requireAdmin } = require('../src/middleware');

let userId;
let adminId;

beforeAll(() => {
    const u = mockDb.prepare(
        'INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?, ?, ?, ?, ?)'
    ).run('alice', 'alice@test.com', 'hash', 'user', new Date(Date.now() - 60_000).toISOString());
    userId = u.lastInsertRowid;

    const a = mockDb.prepare(
        'INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?, ?, ?, ?, ?)'
    ).run('bob', 'bob@test.com', 'hash', 'admin', new Date(Date.now() - 60_000).toISOString());
    adminId = a.lastInsertRowid;
});

afterAll(() => {
    mockDb.close();
});

function mockReq(token) {
    return {
        headers: token ? { authorization: `Bearer ${token}` } : {}
    };
}

function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

describe('authenticateToken - 实际函数', () => {
    test('缺少 Authorization 头应返回 401 Unauthorized', () => {
        const req = mockReq(null);
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    test('Authorization 头无空格分隔时第二段为 undefined 应返回 401', () => {
        const req = { headers: { authorization: 'just-one-word' } };
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('Authorization 头无 Bearer 前缀但有 token 会被尝试校验并返回 403', () => {
        // 中间件不强制 "Bearer" 前缀，只取 split(' ')[1]
        const req = { headers: { authorization: 'Custom abc' } };
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);
        // 'abc' 不是合法 JWT → 403 Invalid token
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('非法 token 应返回 403 Invalid token', () => {
        const req = mockReq('not-a-real-jwt');
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
        expect(next).not.toHaveBeenCalled();
    });

    test('用错误密钥签名的 token 应返回 403', () => {
        const bad = jwt.sign({ userId }, 'wrong-secret', { expiresIn: '1h' });
        const req = mockReq(bad);
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('指向不存在用户的 token 应返回 403 User not found', () => {
        const ghost = jwt.sign({ userId: 99999 }, 'middleware-test-secret', { expiresIn: '1h' });
        const req = mockReq(ghost);
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
        expect(next).not.toHaveBeenCalled();
    });

    test('有效 token 且密码未修改过应通过并填充 req.user', (done) => {
        const token = jwt.sign({ userId, username: 'alice', role: 'user' }, 'middleware-test-secret', { expiresIn: '1h' });
        const req = mockReq(token);
        const res = mockRes();
        const next = jest.fn(() => {
            try {
                expect(next).toHaveBeenCalled();
                expect(req.user.userId).toBe(userId);
                expect(req.user.username).toBe('alice');
                expect(req.user.role).toBe('user');
                done();
            } catch (e) {
                done(e);
            }
        });

        authenticateToken(req, res, next);
    });

    test('密码修改后旧 token 应被拒绝（安全：password_changed_at 检查）', (done) => {
        // 签发 token
        const token = jwt.sign({ userId, username: 'alice', role: 'user' }, 'middleware-test-secret', { expiresIn: '1h' });
        // 模拟用户修改密码（password_changed_at 推进到 token 签发之后 5 秒）
        const futureChangedAt = new Date(Date.now() + 5_000).toISOString();
        mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(futureChangedAt, userId);

        const req = mockReq(token);
        const res = mockRes();
        const next = jest.fn();

        authenticateToken(req, res, next);

        // 异步校验：res.json 一定会被调用
        setImmediate(() => {
            try {
                expect(res.status).toHaveBeenCalledWith(403);
                expect(res.json).toHaveBeenCalledWith({ error: 'Token expired due to password change' });
                expect(next).not.toHaveBeenCalled();
                done();
            } catch (e) {
                done(e);
            } finally {
                // 还原数据库状态
                mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?')
                    .run(new Date(Date.now() - 60_000).toISOString(), userId);
            }
        });
    });

    test('新签发 token 在密码修改之后应仍能通过（iat 较新）', (done) => {
        // 先把 password_changed_at 推进到"过去很久"
        const oldChange = new Date(Date.now() - 10_000).toISOString();
        mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(oldChange, userId);

        const token = jwt.sign({ userId, username: 'alice', role: 'user' }, 'middleware-test-secret', { expiresIn: '1h' });
        const req = mockReq(token);
        const res = mockRes();
        const next = jest.fn(() => {
            try {
                expect(req.user.userId).toBe(userId);
                done();
            } catch (e) {
                done(e);
            }
        });

        authenticateToken(req, res, next);
    });
});

describe('requireAdmin - 实际函数', () => {
    test('无 req.user 应返回 403', () => {
        const req = {};
        const res = mockRes();
        const next = jest.fn();

        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: '需要管理员权限' });
        expect(next).not.toHaveBeenCalled();
    });

    test('普通用户应被拒绝', () => {
        const req = { user: { userId: 1, role: 'user' } };
        const res = mockRes();
        const next = jest.fn();

        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('未定义 role 应被拒绝（默认非 admin）', () => {
        const req = { user: { userId: 1 } };
        const res = mockRes();
        const next = jest.fn();

        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('管理员应通过', () => {
        const req = { user: { userId: adminId, role: 'admin' } };
        const res = mockRes();
        const next = jest.fn();

        requireAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
