process.env.JWT_SECRET = 'test-secret-key';

const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const mockDb = new Database(':memory:');
mockDb.exec(`
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

const result = mockDb.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', 'hashed', 'user');
const testUserId = result.lastInsertRowid;

const adminResult = mockDb.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', 'hashed', 'admin');
const adminUserId = adminResult.lastInsertRowid;

jest.mock('./database', () => ({
    getDb: () => mockDb
}));

const {
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml,
    authenticateToken,
    requireAdmin
} = require('./middleware');

afterAll(() => {
    mockDb.close();
});

describe('validateUsername - 用户名验证', () => {
    test('空值应返回错误', () => {
        expect(validateUsername(null)).toBe('用户名不能为空');
        expect(validateUsername(undefined)).toBe('用户名不能为空');
        expect(validateUsername('')).toBe('用户名不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validateUsername(123)).toBe('用户名不能为空');
        expect(validateUsername({})).toBe('用户名不能为空');
        expect(validateUsername([])).toBe('用户名不能为空');
    });

    test('长度不足2应返回错误', () => {
        expect(validateUsername('a')).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('长度超过20应返回错误', () => {
        expect(validateUsername('a'.repeat(21))).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('包含特殊字符应返回错误', () => {
        expect(validateUsername('user@name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user!name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
    });

    test('有效用户名应返回 null', () => {
        expect(validateUsername('user')).toBeNull();
        expect(validateUsername('user_name')).toBeNull();
        expect(validateUsername('user-name')).toBeNull();
        expect(validateUsername('User123')).toBeNull();
        expect(validateUsername('用户名')).toBeNull();
        expect(validateUsername('中文User')).toBeNull();
    });

    test('首尾空格应被忽略', () => {
        expect(validateUsername('  user  ')).toBeNull();
    });
});

describe('validateEmail - 邮箱验证', () => {
    test('空值应返回错误', () => {
        expect(validateEmail(null)).toBe('邮箱不能为空');
        expect(validateEmail(undefined)).toBe('邮箱不能为空');
        expect(validateEmail('')).toBe('邮箱不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validateEmail(123)).toBe('邮箱不能为空');
    });

    test('无效格式应返回错误', () => {
        expect(validateEmail('user')).toBe('邮箱格式不正确');
        expect(validateEmail('user@')).toBe('邮箱格式不正确');
        expect(validateEmail('user@domain')).toBe('邮箱格式不正确');
        expect(validateEmail('@domain.com')).toBe('邮箱格式不正确');
        expect(validateEmail('user@.com')).toBe('邮箱格式不正确');
    });

    test('有效邮箱应返回 null', () => {
        expect(validateEmail('user@domain.com')).toBeNull();
        expect(validateEmail('user.name@domain.com')).toBeNull();
        expect(validateEmail('user+tag@domain.com')).toBeNull();
        expect(validateEmail('user@sub.domain.com')).toBeNull();
        expect(validateEmail('USER@DOMAIN.COM')).toBeNull();
    });

    test('首尾空格应被忽略', () => {
        expect(validateEmail('  user@domain.com  ')).toBeNull();
    });
});

describe('validatePassword - 密码验证', () => {
    test('空值应返回错误', () => {
        expect(validatePassword(null)).toBe('密码不能为空');
        expect(validatePassword(undefined)).toBe('密码不能为空');
        expect(validatePassword('')).toBe('密码不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validatePassword(123)).toBe('密码不能为空');
    });

    test('长度不足6位应返回错误', () => {
        expect(validatePassword('12345')).toBe('密码至少 6 位');
        expect(validatePassword('abc')).toBe('密码至少 6 位');
    });

    test('长度超过128位应返回错误', () => {
        expect(validatePassword('a'.repeat(129))).toBe('密码不能超过 128 位');
    });

    test('有效密码应返回 null', () => {
        expect(validatePassword('123456')).toBeNull();
        expect(validatePassword('abcdef')).toBeNull();
        expect(validatePassword('password123')).toBeNull();
        expect(validatePassword('a'.repeat(128))).toBeNull();
    });
});

describe('handleError - 错误处理', () => {
    test('SQLITE_CONSTRAINT_UNIQUE 应返回 409', () => {
        const err = new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed');
        const result = handleError(err, 'test');
        expect(result.status).toBe(409);
        expect(result.message).toBe('该数据已存在，请换一个试试');
    });

    test('SQLITE_CONSTRAINT 应返回 400', () => {
        const err = new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');
        const result = handleError(err, 'test');
        expect(result.status).toBe(400);
        expect(result.message).toBe('数据约束冲突，请检查输入');
    });

    test('SQLITE_ERROR 应返回 500', () => {
        const err = new Error('SQLITE_ERROR: no such table');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toBe('数据库操作失败，请稍后重试');
    });

    test('其他错误应返回 500 通用消息', () => {
        const err = new Error('Unexpected error');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toBe('服务器异常，请稍后重试');
    });

    test('应包含 context 参数', () => {
        const err = new Error('test error');
        handleError(err, 'register');
    });
});

describe('escapeHtml - HTML转义', () => {
    test('空值应返回空字符串', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml('')).toBe('');
    });

    test('特殊字符应被转义', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('>&<')).toBe('&gt;&amp;&lt;');
        expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
        expect(escapeHtml("'single'")).toBe('&#x27;single&#x27;');
        expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    });

    test('普通文本应保持不变', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
        expect(escapeHtml('123 test')).toBe('123 test');
        expect(escapeHtml('中文文本')).toBe('中文文本');
    });

    test('混合内容应正确转义', () => {
        expect(escapeHtml('<div class="test">Hello & World</div>'))
            .toBe('&lt;div class=&quot;test&quot;&gt;Hello &amp; World&lt;/div&gt;');
    });

    test('XSS攻击载荷应被转义', () => {
        const payload = '<script>alert("XSS")</script>';
        const escaped = escapeHtml(payload);
        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('</script>');
        expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });
});

describe('authenticateToken - JWT 认证中间件', () => {
    function mockReq(authHeader) {
        return { headers: { authorization: authHeader } };
    }
    function mockRes() {
        const res = {
            statusCode: 200,
            body: null,
            status(code) {
                res.statusCode = code;
                return res;
            },
            json(data) {
                res.body = data;
                return res;
            }
        };
        return res;
    }

    test('无 token 应返回 401 Unauthorized', () => {
        const req = mockReq(undefined);
        const res = mockRes();
        const result = authenticateToken(req, res, () => {});
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    test('无效 token 应返回 403 Invalid token', (done) => {
        const req = mockReq('Bearer invalid-token');
        const res = mockRes();
        authenticateToken(req, res, () => {});
        setImmediate(() => {
            expect(res.statusCode).toBe(403);
            expect(res.body.error).toBe('Invalid token');
            done();
        });
    });

    test('有效 token 应设置 req.user 并调用 next', (done) => {
        const token = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const req = mockReq(`Bearer ${token}`);
        const res = mockRes();
        authenticateToken(req, res, (err) => {
            expect(err).toBeUndefined();
            expect(req.user).toBeDefined();
            expect(req.user.userId).toBe(testUserId);
            expect(req.user.username).toBe('testuser');
            expect(res.statusCode).toBe(200);
            done();
        });
    });

    test('用户不存在应返回 403 User not found', (done) => {
        const token = jwt.sign({ userId: 99999, username: 'nonexistent', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const req = mockReq(`Bearer ${token}`);
        const res = mockRes();
        authenticateToken(req, res, () => {});
        setImmediate(() => {
            expect(res.statusCode).toBe(403);
            expect(res.body.error).toBe('User not found');
            done();
        });
    });

    test('密码变更后旧 token 应被撤销', (done) => {
        const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const token = jwt.sign(
            { userId: testUserId, username: 'testuser', role: 'user', iat: Math.floor(pastDate.getTime() / 1000) },
            process.env.JWT_SECRET
        );

        const futureDate = new Date(Date.now() + 60 * 60 * 1000);
        mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(futureDate.toISOString(), testUserId);

        const req = mockReq(`Bearer ${token}`);
        const res = mockRes();
        authenticateToken(req, res, () => {});
        setImmediate(() => {
            expect(res.statusCode).toBe(403);
            expect(res.body.error).toBe('Token expired due to password change');
            mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(new Date().toISOString(), testUserId);
            done();
        });
    });

    test('密码变更前签发的 token 应仍然有效', (done) => {
        const tokenIssuedAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const token = jwt.sign(
            { userId: testUserId, username: 'testuser', role: 'user', iat: Math.floor(tokenIssuedAt.getTime() / 1000) },
            process.env.JWT_SECRET
        );

        const passwordChangedAt = new Date(Date.now() - 60 * 60 * 1000);
        mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(passwordChangedAt.toISOString(), testUserId);

        const req = mockReq(`Bearer ${token}`);
        const res = mockRes();
        authenticateToken(req, res, (err) => {
            expect(err).toBeUndefined();
            expect(req.user).toBeDefined();
            expect(req.user.userId).toBe(testUserId);
            mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(new Date().toISOString(), testUserId);
            done();
        });
    });

    test('缺少 password_changed_at 字段应正常通过', (done) => {
        mockDb.prepare('UPDATE users SET password_changed_at = NULL WHERE id = ?').run(testUserId);
        const token = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const req = mockReq(`Bearer ${token}`);
        const res = mockRes();
        authenticateToken(req, res, (err) => {
            expect(err).toBeUndefined();
            expect(req.user).toBeDefined();
            expect(req.user.userId).toBe(testUserId);
            mockDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(new Date().toISOString(), testUserId);
            done();
        });
    });
});

describe('requireAdmin - 管理员权限中间件', () => {
    function mockRes() {
        const res = {
            statusCode: 200,
            body: null,
            status(code) {
                res.statusCode = code;
                return res;
            },
            json(data) {
                res.body = data;
                return res;
            }
        };
        return res;
    }

    test('普通用户应返回 403', () => {
        const req = { user: { userId: testUserId, role: 'user' } };
        const res = mockRes();
        let nextCalled = false;
        requireAdmin(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toContain('管理员权限');
    });

    test('管理员应调用 next', () => {
        const req = { user: { userId: adminUserId, role: 'admin' } };
        const res = mockRes();
        let nextCalled = false;
        requireAdmin(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBe(200);
    });

    test('无 req.user 应返回 403', () => {
        const req = {};
        const res = mockRes();
        let nextCalled = false;
        requireAdmin(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
    });

    test('role 为 undefined 应返回 403', () => {
        const req = { user: { userId: testUserId } };
        const res = mockRes();
        let nextCalled = false;
        requireAdmin(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
    });
});
