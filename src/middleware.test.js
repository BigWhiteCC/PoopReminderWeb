process.env.JWT_SECRET = 'test-secret-key';

const { validateUsername, validateEmail, validatePassword, handleError, escapeHtml } = require('./middleware');

describe('validateUsername - 用户名验证', () => {
    test('空用户名应返回错误', () => {
        expect(validateUsername('')).toBe('用户名不能为空');
        expect(validateUsername(null)).toBe('用户名不能为空');
        expect(validateUsername(undefined)).toBe('用户名不能为空');
    });

    test('长度不足应返回错误', () => {
        expect(validateUsername('a')).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('长度超过应返回错误', () => {
        expect(validateUsername('a'.repeat(21))).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('包含非法字符应返回错误', () => {
        expect(validateUsername('test@user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('test#user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('test user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
    });

    test('合法用户名应返回 null', () => {
        expect(validateUsername('testuser')).toBeNull();
        expect(validateUsername('test_user')).toBeNull();
        expect(validateUsername('test-user')).toBeNull();
        expect(validateUsername('测试用户')).toBeNull();
        expect(validateUsername('Test123')).toBeNull();
    });

    test('前后空格应被忽略', () => {
        expect(validateUsername('  testuser  ')).toBeNull();
    });
});

describe('validateEmail - 邮箱验证', () => {
    test('空邮箱应返回错误', () => {
        expect(validateEmail('')).toBe('邮箱不能为空');
        expect(validateEmail(null)).toBe('邮箱不能为空');
    });

    test('格式不正确应返回错误', () => {
        expect(validateEmail('invalid-email')).toBe('邮箱格式不正确');
        expect(validateEmail('@example.com')).toBe('邮箱格式不正确');
        expect(validateEmail('user@')).toBe('邮箱格式不正确');
        expect(validateEmail('user@.com')).toBe('邮箱格式不正确');
    });

    test('合法邮箱应返回 null', () => {
        expect(validateEmail('user@example.com')).toBeNull();
        expect(validateEmail('test.user@domain.co')).toBeNull();
        expect(validateEmail('user123@example.org')).toBeNull();
    });

    test('前后空格应被忽略', () => {
        expect(validateEmail('  user@example.com  ')).toBeNull();
    });
});

describe('validatePassword - 密码验证', () => {
    test('空密码应返回错误', () => {
        expect(validatePassword('')).toBe('密码不能为空');
        expect(validatePassword(null)).toBe('密码不能为空');
    });

    test('长度不足应返回错误', () => {
        expect(validatePassword('12345')).toBe('密码至少 6 位');
    });

    test('长度超过应返回错误', () => {
        expect(validatePassword('a'.repeat(129))).toBe('密码不能超过 128 位');
    });

    test('合法密码应返回 null', () => {
        expect(validatePassword('123456')).toBeNull();
        expect(validatePassword('password123')).toBeNull();
        expect(validatePassword('a'.repeat(128))).toBeNull();
    });
});

describe('escapeHtml - HTML 转义', () => {
    test('空值应返回空字符串', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml('')).toBe('');
    });

    test('普通字符串应保持不变', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
        expect(escapeHtml('123 test')).toBe('123 test');
    });

    test('特殊字符应被转义', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#x27;');
        expect(escapeHtml('>')).toBe('&gt;');
    });

    test('完整 XSS 攻击应被转义', () => {
        const xss = '<script>alert("XSS")</script>';
        const escaped = escapeHtml(xss);
        expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
        expect(escaped).not.toContain('<script>');
    });

    test('非零数字应被转换为字符串', () => {
        expect(escapeHtml(123)).toBe('123');
        expect(escapeHtml(45.6)).toBe('45.6');
    });

    test('零值应返回空字符串', () => {
        expect(escapeHtml(0)).toBe('');
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

    test('其他错误应返回 500', () => {
        const err = new Error('Unknown error');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toBe('服务器异常，请稍后重试');
    });

    test('无消息错误应被处理', () => {
        const err = new Error();
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
    });

    test('非 Error 对象应被转换', () => {
        const result = handleError('string error', 'test');
        expect(result.status).toBe(500);
    });
});