process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

let mockDb;
jest.mock('./database', () => ({
    getDb: () => mockDb
}));

const {
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml,
    authenticateToken
} = require('./middleware');

// 构造可链式调用的 mock res
function makeRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
    return res;
}

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

// ============ 集成测试：authenticateToken 中间件 ============
// 重点覆盖：密码修改后旧 token 失效（iat + 1秒 < password_changed_at 时拒绝）
describe('authenticateToken - 中间件集成', () => {
    let testUserId;
    const baseTime = new Date('2024-06-15T10:00:00.000Z').getTime();

    beforeAll(() => {
        mockDb = new Database(':memory:');
        mockDb.exec(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                enabled INTEGER DEFAULT 1,
                password_changed_at TEXT
            );
        `);
        const r = mockDb.prepare(
            'INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?, ?, ?, ?, ?)'
        ).run('alice', 'alice@test.com', 'hash', 'user', new Date(baseTime).toISOString());
        testUserId = r.lastInsertRowid;
    });

    function callAuth(token) {
        return new Promise(resolve => {
            let settled = false;
            const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
            const res = makeRes();
            authenticateToken(req, res, () => {
                if (settled) return;
                settled = true;
                resolve({ res, nextCalled: true, req });
            });
            // jwt.verify 的回调异步触发；给 50ms 让异步链跑完
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ res, nextCalled: false, req });
                }
            }, 50);
        });
    }

    // 生成一个以指定 iat 签发的有效 token
    // 注意：exp 始终保持在未来 30 天，确保 jwt.verify 不会因过期失败
    function signAt(userId, iatSec) {
        const expSec = Math.max(iatSec + 30 * 86400, Math.floor(Date.now() / 1000) + 30 * 86400);
        return jwt.sign(
            { userId, username: 'alice', role: 'user', iat: iatSec, exp: expSec },
            process.env.JWT_SECRET
        );
    }

    test('无 token 应返回 401', async () => {
        const { res, nextCalled } = await callAuth(null);
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
        expect(nextCalled).toBe(false);
    });

    test('无效 token 应返回 403', async () => {
        const { res, nextCalled } = await callAuth('not-a-jwt');
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('Invalid token');
        expect(nextCalled).toBe(false);
    });

    test('iat 早于 password_changed_at 应返回 403（强制旧 token 失效）', async () => {
        // password_changed_at = 2024-06-15T10:00:00Z
        // 签发 token 时 iat = 2024-01-01（早于密码修改时间）
        const iatSec = Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000);
        const forged = signAt(testUserId, iatSec);
        const { res, nextCalled } = await callAuth(forged);
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('Token expired due to password change');
        expect(nextCalled).toBe(false);
    });

    test('iat 晚于 password_changed_at 应放行并设置 req.user', async () => {
        // iat 远晚于 password_changed_at
        const iatSec = Math.floor(new Date('2024-12-01T00:00:00Z').getTime() / 1000);
        const newToken = signAt(testUserId, iatSec);
        const { nextCalled, req } = await callAuth(newToken);
        expect(nextCalled).toBe(true);
        expect(req.user.userId).toBe(testUserId);
    });

    test('iat 处于 1 秒容差窗口内应放行（避免误杀并发请求）', async () => {
        // password_changed_at = 2024-06-15T10:00:00.000Z
        // 令 iat = 2024-06-15T09:59:59.500Z（比 changedAt 早 500ms，1秒容差内应放行）
        const iatSec = Math.floor(new Date('2024-06-15T09:59:59.500Z').getTime() / 1000);
        const toleranceToken = signAt(testUserId, iatSec);
        const { nextCalled } = await callAuth(toleranceToken);
        expect(nextCalled).toBe(true);
    });

    test('token 中的 userId 在库里不存在应返回 403', async () => {
        const ghostToken = signAt(99999, Math.floor(Date.now() / 1000));
        const { res, nextCalled } = await callAuth(ghostToken);
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('User not found');
        expect(nextCalled).toBe(false);
    });

    test('password_changed_at 为 NULL 时不应触发失效逻辑', async () => {
        const r = mockDb.prepare(
            'INSERT INTO users (username, email, password, password_changed_at) VALUES (?, ?, ?, ?)'
        ).run('bob', 'bob@test.com', 'hash', null);
        const newId = r.lastInsertRowid;
        // 哪怕 iat = epoch 0，也不应拒绝（NULL 视为未设置）
        const oldToken = signAt(newId, 0);
        const { nextCalled } = await callAuth(oldToken);
        expect(nextCalled).toBe(true);
    });
});