const { validateUsername, validateEmail, validatePassword, escapeHtml, handleError } = require('./middleware');

describe('validateUsername - 用户名验证', () => {
    test('空值应返回错误', () => {
        expect(validateUsername(null)).toBe('用户名不能为空');
        expect(validateUsername(undefined)).toBe('用户名不能为空');
        expect(validateUsername('')).toBe('用户名不能为空');
        expect(validateUsername('   ')).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('非字符串应返回错误', () => {
        expect(validateUsername(123)).toBe('用户名不能为空');
        expect(validateUsername({})).toBe('用户名不能为空');
        expect(validateUsername([])).toBe('用户名不能为空');
    });

    test('长度不足2位应返回错误', () => {
        expect(validateUsername('a')).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('长度超过20位应返回错误', () => {
        expect(validateUsername('a'.repeat(21))).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('包含特殊字符应返回错误', () => {
        expect(validateUsername('user@name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user#name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
    });

    test('有效用户名应返回 null', () => {
        expect(validateUsername('user')).toBeNull();
        expect(validateUsername('user_name')).toBeNull();
        expect(validateUsername('user-name')).toBeNull();
        expect(validateUsername('user123')).toBeNull();
        expect(validateUsername('测试用户')).toBeNull();
        expect(validateUsername('TestUser')).toBeNull();
    });

    test('带前后空格的有效用户名应返回 null', () => {
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
        expect(validateEmail('test')).toBe('邮箱格式不正确');
        expect(validateEmail('test@')).toBe('邮箱格式不正确');
        expect(validateEmail('@test.com')).toBe('邮箱格式不正确');
        expect(validateEmail('test@test')).toBe('邮箱格式不正确');
        expect(validateEmail('test@.com')).toBe('邮箱格式不正确');
    });

    test('有效邮箱应返回 null', () => {
        expect(validateEmail('test@example.com')).toBeNull();
        expect(validateEmail('user.name@example.com')).toBeNull();
        expect(validateEmail('user_name@example.com')).toBeNull();
        expect(validateEmail('user+tag@example.com')).toBeNull();
        expect(validateEmail('TEST@EXAMPLE.COM')).toBeNull();
    });

    test('带空格的邮箱应返回错误', () => {
        expect(validateEmail('test @example.com')).toBe('邮箱格式不正确');
        expect(validateEmail('test@ example.com')).toBe('邮箱格式不正确');
    });
});

describe('validatePassword - 密码验证', () => {
    test('空值应返回错误', () => {
        expect(validatePassword(null)).toBe('密码不能为空');
        expect(validatePassword(undefined)).toBe('密码不能为空');
        expect(validatePassword('')).toBe('密码不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validatePassword(123456)).toBe('密码不能为空');
    });

    test('长度不足6位应返回错误', () => {
        expect(validatePassword('12345')).toBe('密码至少 6 位');
    });

    test('长度超过128位应返回错误', () => {
        expect(validatePassword('a'.repeat(129))).toBe('密码不能超过 128 位');
    });

    test('有效密码应返回 null', () => {
        expect(validatePassword('123456')).toBeNull();
        expect(validatePassword('password')).toBeNull();
        expect(validatePassword('P@ssw0rd')).toBeNull();
        expect(validatePassword('a'.repeat(128))).toBeNull();
    });
});

describe('escapeHtml - HTML转义', () => {
    test('空值应返回空字符串', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml('')).toBe('');
    });

    test('普通文本应保持不变', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
        expect(escapeHtml('123 test')).toBe('123 test');
    });

    test('HTML特殊字符应被转义', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(escapeHtml('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
        expect(escapeHtml("'single quotes'")).toBe('&#x27;single quotes&#x27;');
    });

    test('混合内容应正确转义', () => {
        expect(escapeHtml('Hello <b>World</b> & Test')).toBe('Hello &lt;b&gt;World&lt;/b&gt; &amp; Test');
    });
});

describe('handleError - 统一错误处理', () => {
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

    test('其他错误应返回 500 默认消息', () => {
        const err = new Error('Unexpected error');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toBe('服务器异常，请稍后重试');
    });

    test('无消息的错误应返回默认消息', () => {
        const err = new Error();
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
    });
});