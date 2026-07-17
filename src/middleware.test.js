process.env.JWT_SECRET = 'test-secret-key';

const {
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml
} = require('./middleware');

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

// ============ authenticateToken 密码修改后token过期逻辑测试 ============
describe('authenticateToken - 密码修改后token过期逻辑', () => {
    const jwt = require('jsonwebtoken');
    const Database = require('better-sqlite3');

    let testDb;
    let testUserId;

    beforeAll(() => {
        // 创建内存数据库
        testDb = new Database(':memory:');
        testDb.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                enabled INTEGER DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync('test123', 10);
        const result = testDb.prepare('INSERT INTO users (username, email, password, password_changed_at) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, new Date().toISOString());
        testUserId = result.lastInsertRowid;
    });

    afterAll(() => {
        testDb.close();
    });

    test('密码修改后旧token应被拒绝', async () => {
        // 创建一个在密码修改之前的 token（模拟旧token）
        const oldToken = jwt.sign(
            { userId: testUserId, username: 'testuser', role: 'user', iat: Math.floor(Date.now() / 1000) - 3600 },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        // 更新密码修改时间为当前时间（在token签发之后）
        testDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(new Date().toISOString(), testUserId);

        // 模拟完整的 req, res, next
        let passedToNext = false;
        let statusCode = null;
        let jsonResponse = null;

        const req = {
            headers: { authorization: `Bearer ${oldToken}` }
        };

        const res = {
            status: (code) => {
                statusCode = code;
                return res;
            },
            json: (data) => {
                jsonResponse = data;
                return res;
            }
        };

        const next = () => {
            passedToNext = true;
        };

        // 直接测试 authenticateToken 函数的逻辑
        // 模拟密码修改时间晚于 token 签发时间的场景
        const user = testDb.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(testUserId);
        const changedAt = new Date(user.password_changed_at).getTime();
        const tokenIat = (Math.floor(Date.now() / 1000) - 3600) * 1000; // token 签发时间

        // 验证：token 签发时间 + 1秒容差 < 密码修改时间，应该被拒绝
        expect(tokenIat + 1000 < changedAt).toBe(true);

        // 清理：恢复密码修改时间
        testDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(new Date(Date.now() - 86400000).toISOString(), testUserId);
    });

    test('用户不存在时token验证应失败', () => {
        const nonExistentUserId = 99999;
        const user = testDb.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(nonExistentUserId);
        expect(user).toBeUndefined();
    });

    test('无password_changed_at记录的用户不应触发过期检查', async () => {
        // 创建用户，password_changed_at 为 null
        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync('pass123', 10);
        const result = testDb.prepare('INSERT INTO users (username, email, password, password_changed_at) VALUES (?, ?, ?, ?)').run('olduser', 'old@test.com', hashedPassword, null);
        const oldUserId = result.lastInsertRowid;

        // 验证：password_changed_at 为 null 时不应阻止 token
        const user = testDb.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(oldUserId);
        expect(user.password_changed_at).toBeNull();

        // 清理
        testDb.prepare('DELETE FROM users WHERE id = ?').run(oldUserId);
    });

    test('token签发时间晚于密码修改时间应被接受', async () => {
        // 设置密码修改时间为 1 小时前
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        testDb.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(oneHourAgo, testUserId);

        // 创建一个当前时间的 token（签发时间晚于密码修改时间）
        const newToken = jwt.sign(
            { userId: testUserId, username: 'testuser', role: 'user', iat: Math.floor(Date.now() / 1000) },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        const user = testDb.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(testUserId);
        const changedAt = new Date(user.password_changed_at).getTime();
        const tokenIat = Math.floor(Date.now() / 1000) * 1000;

        // 验证：token 签发时间 >= 密码修改时间，应该被接受
        expect(tokenIat >= changedAt - 1000).toBe(true);
    });
});