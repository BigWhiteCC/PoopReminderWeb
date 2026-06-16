'use strict';

const {
    authenticateToken,
    requireAdmin
} = require('../lib/middleware');

describe('authenticateToken', () => {
    const jwt = require('jsonwebtoken');
    const SECRET = 'test-secret';

    beforeAll(() => {
        process.env.JWT_SECRET = SECRET;
    });

    const makeRes = () => {
        const res = {
            _code: 0,
            _json: null,
            status(code) { this._code = code; return this; },
            json(payload) { this._json = payload; return this; }
        };
        return res;
    };

    test('缺失 Authorization 头 → 401', () => {
        const req = { headers: {} };
        const res = makeRes();
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        authenticateToken(req, res, next);
        expect(res._code).toBe(401);
        expect(res._json.error).toBe('Unauthorized');
        expect(nextCalled).toBe(false);
    });

    test('Authorization 只有 "Bearer " 但 token 无效 → 403', () => {
        const req = { headers: { authorization: 'Bearer not-a-valid-jwt' } };
        const res = makeRes();
        const next = jest.fn();
        authenticateToken(req, res, next);
        expect(res._code).toBe(403);
        expect(res._json.error).toBe('Invalid token');
        expect(next).not.toHaveBeenCalled();
    });

    test('有效 token → 解析成功，调用 next', () => {
        const token = jwt.sign({ userId: 42, username: 'test', role: 'user' }, SECRET, { expiresIn: '1h' });
        const req = { headers: { authorization: 'Bearer ' + token } };
        const res = makeRes();
        const next = jest.fn();
        authenticateToken(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).not.toBeUndefined();
        expect(req.user.userId).toBe(42);
        expect(req.user.role).toBe('user');
        expect(res._code).toBe(0); // 未设置
    });

    test('管理员 token → 解析成功', () => {
        const token = jwt.sign({ userId: 1, username: 'admin', role: 'admin' }, SECRET, { expiresIn: '1h' });
        const req = { headers: { authorization: 'Bearer ' + token } };
        const res = makeRes();
        const next = jest.fn();
        authenticateToken(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user.role).toBe('admin');
    });

    test('过期 token → 403', () => {
        const token = jwt.sign({ userId: 99 }, SECRET, { expiresIn: '-1s' });
        const req = { headers: { authorization: 'Bearer ' + token } };
        const res = makeRes();
        const next = jest.fn();
        authenticateToken(req, res, next);
        expect(res._code).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('错误密钥签名的 token → 403', () => {
        const token = jwt.sign({ userId: 99 }, 'wrong-secret', { expiresIn: '1h' });
        const req = { headers: { authorization: 'Bearer ' + token } };
        const res = makeRes();
        const next = jest.fn();
        authenticateToken(req, res, next);
        expect(res._code).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('requireAdmin', () => {
    const makeRes = () => {
        const res = {
            _code: 0,
            _json: null,
            status(code) { this._code = code; return this; },
            json(payload) { this._json = payload; return this; }
        };
        return res;
    };

    test('未认证（无 req.user）→ 403', () => {
        const req = {};
        const res = makeRes();
        const next = jest.fn();
        requireAdmin(req, res, next);
        expect(res._code).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('普通用户 → 403', () => {
        const req = { user: { userId: 1, username: 'u', role: 'user' } };
        const res = makeRes();
        const next = jest.fn();
        requireAdmin(req, res, next);
        expect(res._code).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('管理员 → 通过', () => {
        const req = { user: { userId: 1, username: 'admin', role: 'admin' } };
        const res = makeRes();
        const next = jest.fn();
        requireAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res._code).toBe(0);
    });
});
