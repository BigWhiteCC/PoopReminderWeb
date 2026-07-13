process.env.JWT_SECRET = 'test-secret-key';

const jwt = require('jsonwebtoken');

// ============ 回归缺口：测试实际生产代码 authenticateToken / requireAdmin ============
// 历史 index.test.js 在测试中复制了一个简化版 authenticateToken，未覆盖：
//   1) password_changed_at > iat 的 token 失效逻辑（含 1 秒容差）
//   2) requireAdmin 对非管理员的拒绝
// 这里通过 mock ./database 把生产代码中的 getDb 注入到内存库，对真实实现做断言。

jest.mock('./database', () => {
    const Database = require('better-sqlite3');
    const inMemDb = new Database(':memory:');
    inMemDb.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            password_changed_at TEXT
        )
    `);
    return { getDb: () => inMemDb };
});

const {
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml,
    authenticateToken,
    requireAdmin
} = require('./middleware');

const { getDb } = require('./database');

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

// ============ 实际生产代码测试 ============

describe('authenticateToken - 认证中间件（实际生产代码）', () => {
    let testUserId;
    const PAST_ISO = '2020-01-01T00:00:00.000Z';

    beforeEach(() => {
        // 每个用例都重置 users 表，避免互相影响
        getDb().exec('DELETE FROM users');
        getDb().exec("DELETE FROM sqlite_sequence WHERE name='users'");
        const r = getDb().prepare('INSERT INTO users (username, password_changed_at) VALUES (?, ?)').run('fixture_user', PAST_ISO);
        testUserId = r.lastInsertRowid;
    });

    // 工具：构造一个 mock req/res 触发中间件
    function invoke(req) {
        return new Promise((resolve) => {
            const res = {
                statusCode: 200,
                body: null,
                status(code) { this.statusCode = code; return this; },
                json(obj) { this.body = obj; resolve(this); return this; }
            };
            const next = jest.fn(() => resolve({ statusCode: 0, next: true }));
            authenticateToken(req, res, next);
        });
    }

    test('无 Authorization 头应返回 401', async () => {
        const r = await invoke({ headers: {} });
        expect(r.statusCode).toBe(401);
        expect(r.body.error).toBe('Unauthorized');
    });

    test('Authorization 头只有一个字段（无 token 部分）应返回 401', async () => {
        // "Basic" 不含空格时 split(' ')[1] 为 undefined，触发 401 分支
        const r = await invoke({ headers: { authorization: 'Basic' } });
        expect(r.statusCode).toBe(401);
    });

    test('token 签名错误应返回 403 Invalid token', async () => {
        const badToken = jwt.sign({ userId: testUserId, username: 'fixture_user' }, 'wrong-secret', { expiresIn: '1h' });
        const r = await invoke({ headers: { authorization: `Bearer ${badToken}` } });
        expect(r.statusCode).toBe(403);
        expect(r.body.error).toBe('Invalid token');
    });

    test('token 已过期应返回 403 Invalid token', async () => {
        // expiresIn: 0 在 jsonwebtoken 中会立即过期
        const expired = jwt.sign({ userId: testUserId, username: 'fixture_user' }, 'test-secret-key', { expiresIn: '0s' });
        const r = await invoke({ headers: { authorization: `Bearer ${expired}` } });
        expect(r.statusCode).toBe(403);
        expect(r.body.error).toBe('Invalid token');
    });

    test('有效 token 应将 user 挂到 req.user 并调用 next()', async () => {
        const token = jwt.sign({ userId: testUserId, username: 'fixture_user' }, 'test-secret-key', { expiresIn: '1h' });
        const result = await invoke({ headers: { authorization: `Bearer ${token}` } });
        expect(result.next).toBe(true);
    });

    test('token 中的 userId 在数据库中不存在应返回 403 User not found', async () => {
        const token = jwt.sign({ userId: 99999, username: 'ghost' }, 'test-secret-key', { expiresIn: '1h' });
        const r = await invoke({ headers: { authorization: `Bearer ${token}` } });
        expect(r.statusCode).toBe(403);
        expect(r.body.error).toBe('User not found');
    });

    test('关键安全回归：password_changed_at 在 token 签发之后应使 token 失效', async () => {
        // 步骤 1：在 t0 签发 token
        const t0 = Math.floor(Date.now() / 1000);
        const token = jwt.sign(
            { userId: testUserId, username: 'fixture_user', iat: t0 },
            'test-secret-key',
            { expiresIn: '1h' }
        );
        // 步骤 2：把 password_changed_at 设为 token 之后 10 秒
        const future = new Date((t0 + 10) * 1000).toISOString();
        getDb().prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(future, testUserId);

        const r = await invoke({ headers: { authorization: `Bearer ${token}` } });
        expect(r.statusCode).toBe(403);
        expect(r.body.error).toBe('Token expired due to password change');
    });

    test('边界：password_changed_at 在 iat 后 1 秒内（含容差）应放行', async () => {
        // 容差 = 1000ms；刚好在 iat 之后 ≤1000ms 不应拒绝
        const t0 = Math.floor(Date.now() / 1000);
        const token = jwt.sign(
            { userId: testUserId, username: 'fixture_user', iat: t0 },
            'test-secret-key',
            { expiresIn: '1h' }
        );
        // iat 是秒级精度；将 changedAt 设为 iat 时刻 + 500ms（小于 1000ms 容差）
        const withinTolerance = new Date(t0 * 1000 + 500).toISOString();
        getDb().prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(withinTolerance, testUserId);

        const result = await invoke({ headers: { authorization: `Bearer ${token}` } });
        expect(result.next).toBe(true);
    });

    test('未发生密码变更（changed_at 早于 iat）应正常放行', async () => {
        const t0 = Math.floor(Date.now() / 1000);
        const token = jwt.sign(
            { userId: testUserId, username: 'fixture_user', iat: t0 },
            'test-secret-key',
            { expiresIn: '1h' }
        );
        // 留 PAST_ISO（2020年），早于 iat
        const result = await invoke({ headers: { authorization: `Bearer ${token}` } });
        expect(result.next).toBe(true);
    });

    test('password_changed_at 为 NULL 且 iat 存在应放行', async () => {
        getDb().prepare('UPDATE users SET password_changed_at = NULL WHERE id = ?').run(testUserId);
        const token = jwt.sign(
            { userId: testUserId, username: 'fixture_user', iat: Math.floor(Date.now() / 1000) },
            'test-secret-key',
            { expiresIn: '1h' }
        );
        const result = await invoke({ headers: { authorization: `Bearer ${token}` } });
        expect(result.next).toBe(true);
    });
});

describe('requireAdmin - 管理员权限校验（实际生产代码）', () => {
    function invoke(req) {
        return new Promise((resolve) => {
            const res = {
                statusCode: 200,
                body: null,
                status(code) { this.statusCode = code; return this; },
                json(obj) { this.body = obj; resolve(this); return this; }
            };
            const next = jest.fn(() => resolve({ statusCode: 0, next: true }));
            requireAdmin(req, res, next);
        });
    }

    test('无 req.user 应返回 403', async () => {
        const r = await invoke({});
        expect(r.statusCode).toBe(403);
        expect(r.body.error).toBe('需要管理员权限');
    });

    test('role 为 user 应返回 403', async () => {
        const r = await invoke({ user: { userId: 1, role: 'user' } });
        expect(r.statusCode).toBe(403);
        expect(r.body.error).toBe('需要管理员权限');
    });

    test('role 缺失应返回 403', async () => {
        const r = await invoke({ user: { userId: 1 } });
        expect(r.statusCode).toBe(403);
    });

    test('role 为 admin 应调用 next()', async () => {
        const result = await invoke({ user: { userId: 1, role: 'admin' } });
        expect(result.next).toBe(true);
    });
});