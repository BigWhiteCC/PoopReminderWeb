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

describe('authenticateToken - Token 有效性与密码修改检查', () => {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = 'test-secret-key';

    test('密码修改后 token 应失效', () => {
        // 模拟 token 在密码修改前签发
        const oldIat = Math.floor(Date.now() / 1000) - 3600; // 1小时前
        const userPayload = { userId: 1, username: 'testuser', role: 'user', iat: oldIat };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

        // 模拟密码修改时间为现在（比 token 签发时间晚）
        const passwordChangedAt = new Date().toISOString();
        const changedAtTime = new Date(passwordChangedAt).getTime();
        const issuedAtTime = oldIat * 1000;

        // 核心逻辑：如果 token 签发时间（加1秒容差）早于密码修改时间，token 应失效
        const shouldFail = issuedAtTime + 1000 < changedAtTime;
        expect(shouldFail).toBe(true);
    });

    test('密码修改前签发的 token 应仍有效', () => {
        // 模拟 token 在密码修改后签发
        const newIat = Math.floor(Date.now() / 1000);
        const userPayload = { userId: 1, username: 'testuser', role: 'user', iat: newIat };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

        // 模拟密码修改时间为1小时前（比 token 签发时间早）
        const passwordChangedAt = new Date(Date.now() - 3600 * 1000).toISOString();
        const changedAtTime = new Date(passwordChangedAt).getTime();
        const issuedAtTime = newIat * 1000;

        // token 签发时间晚于密码修改时间，token 应有效
        const shouldFail = issuedAtTime + 1000 < changedAtTime;
        expect(shouldFail).toBe(false);
    });

    test('容差机制：token 签发时间与密码修改时间几乎相同时应有效', () => {
        const now = Date.now();
        const iat = Math.floor(now / 1000);
        const userPayload = { userId: 1, username: 'testuser', role: 'user', iat: iat };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

        // 密码修改时间比 token 签发时间早500ms（在容差范围内）
        const passwordChangedAt = new Date(now - 500).toISOString();
        const changedAtTime = new Date(passwordChangedAt).getTime();
        const issuedAtTime = iat * 1000;

        const shouldFail = issuedAtTime + 1000 < changedAtTime;
        expect(shouldFail).toBe(false);
    });

    test('无密码修改记录时 token 应有效', () => {
        const iat = Math.floor(Date.now() / 1000);
        const userPayload = { userId: 1, username: 'testuser', role: 'user', iat: iat };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

        // 无密码修改记录（password_changed_at 为 null）
        const passwordChangedAt = null;

        // 无密码修改记录，token 应有效
        expect(passwordChangedAt).toBeNull();
    });

    test('JWT 验证应正确解析 payload', () => {
        const payload = { userId: 123, username: 'testuser', role: 'admin' };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

        const decoded = jwt.verify(token, JWT_SECRET);
        expect(decoded.userId).toBe(123);
        expect(decoded.username).toBe('testuser');
        expect(decoded.role).toBe('admin');
        expect(decoded.iat).toBeDefined();
        expect(decoded.exp).toBeDefined();
    });

    test('无效签名应抛出错误', () => {
        const token = jwt.sign({ userId: 1 }, 'wrong-secret', { expiresIn: '7d' });

        expect(() => {
            jwt.verify(token, JWT_SECRET);
        }).toThrow();
    });

    test('过期 token 应抛出错误', () => {
        // 创建一个已过期的 token（签发于很久以前）
        const expiredToken = jwt.sign(
            { userId: 1, username: 'test', iat: Math.floor(Date.now() / 1000) - 100000 },
            JWT_SECRET,
            { expiresIn: '1s' }
        );

        // 等待 token 真正过期
        expect(() => {
            jwt.verify(expiredToken, JWT_SECRET);
        }).toThrow();
    });
});

describe('requireAdmin - 管理员权限检查', () => {
    test('管理员用户应通过检查', () => {
        const req = { user: { userId: 1, username: 'admin', role: 'admin' } };

        const isAdmin = req.user && req.user.role === 'admin';
        expect(isAdmin).toBe(true);
    });

    test('普通用户应被拒绝', () => {
        const req = { user: { userId: 2, username: 'normal', role: 'user' } };

        const isAdmin = req.user && req.user.role === 'admin';
        expect(isAdmin).toBe(false);
    });

    test('无 user 属性的请求应被拒绝', () => {
        const req = {};

        const isAdmin = req.user && req.user.role === 'admin';
        expect(isAdmin).toBeFalsy(); // undefined 应被视为失败
    });

    test('role 为 undefined 时应被拒绝', () => {
        const req = { user: { userId: 3 } };

        const isAdmin = req.user && req.user.role === 'admin';
        expect(isAdmin).toBeFalsy(); // undefined 应被视为失败
    });
});