'use strict';

const { validateUsername, validateEmail, validatePassword, handleError, escapeHtml } = require('./middleware');

describe('validateUsername - 用户名验证', () => {
    test('有效用户名应返回 null', () => {
        expect(validateUsername('testuser')).toBeNull();
        expect(validateUsername('test-user')).toBeNull();
        expect(validateUsername('test_user')).toBeNull();
        expect(validateUsername('用户123')).toBeNull();
        expect(validateUsername('a'.repeat(2))).toBeNull();
        expect(validateUsername('a'.repeat(20))).toBeNull();
    });

    test('空值应返回错误', () => {
        expect(validateUsername(null)).toBe('用户名不能为空');
        expect(validateUsername(undefined)).toBe('用户名不能为空');
        expect(validateUsername('')).toBe('用户名不能为空');
    });

    test('非字符串输入应返回错误', () => {
        expect(validateUsername(123)).toBe('用户名不能为空');
        expect(validateUsername({})).toBe('用户名不能为空');
        expect(validateUsername([])).toBe('用户名不能为空');
    });

    test('长度不符合应返回错误', () => {
        expect(validateUsername('a')).toBe('用户名长度需在 2-20 个字符之间');
        expect(validateUsername('a'.repeat(21))).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('包含特殊字符应返回错误', () => {
        expect(validateUsername('test@user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('test user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('test#user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('test$user')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
    });

    test('首尾空格应被忽略', () => {
        expect(validateUsername('  testuser  ')).toBeNull();
        expect(validateUsername('  a  ')).toBe('用户名长度需在 2-20 个字符之间');
    });
});

describe('validateEmail - 邮箱验证', () => {
    test('有效邮箱应返回 null', () => {
        expect(validateEmail('test@example.com')).toBeNull();
        expect(validateEmail('test.user@example.com')).toBeNull();
        expect(validateEmail('test_user@example.com')).toBeNull();
        expect(validateEmail('test+tag@example.com')).toBeNull();
        expect(validateEmail('TEST@EXAMPLE.COM')).toBeNull();
    });

    test('空值应返回错误', () => {
        expect(validateEmail(null)).toBe('邮箱不能为空');
        expect(validateEmail(undefined)).toBe('邮箱不能为空');
        expect(validateEmail('')).toBe('邮箱不能为空');
    });

    test('非字符串输入应返回错误', () => {
        expect(validateEmail(123)).toBe('邮箱不能为空');
        expect(validateEmail({})).toBe('邮箱不能为空');
    });

    test('无效格式应返回错误', () => {
        expect(validateEmail('test')).toBe('邮箱格式不正确');
        expect(validateEmail('test@')).toBe('邮箱格式不正确');
        expect(validateEmail('test@com')).toBe('邮箱格式不正确');
        expect(validateEmail('@example.com')).toBe('邮箱格式不正确');
        expect(validateEmail('test@.com')).toBe('邮箱格式不正确');
        expect(validateEmail('test@example')).toBe('邮箱格式不正确');
        expect(validateEmail('test @example.com')).toBe('邮箱格式不正确');
        expect(validateEmail('test@ example.com')).toBe('邮箱格式不正确');
    });

    test('首尾空格应被忽略', () => {
        expect(validateEmail('  test@example.com  ')).toBeNull();
    });
});

describe('validatePassword - 密码验证', () => {
    test('有效密码应返回 null', () => {
        expect(validatePassword('password')).toBeNull();
        expect(validatePassword('a'.repeat(6))).toBeNull();
        expect(validatePassword('a'.repeat(128))).toBeNull();
        expect(validatePassword('123456')).toBeNull();
        expect(validatePassword('Abc123!@#')).toBeNull();
    });

    test('空值应返回错误', () => {
        expect(validatePassword(null)).toBe('密码不能为空');
        expect(validatePassword(undefined)).toBe('密码不能为空');
        expect(validatePassword('')).toBe('密码不能为空');
    });

    test('非字符串输入应返回错误', () => {
        expect(validatePassword(123456)).toBe('密码不能为空');
        expect(validatePassword({})).toBe('密码不能为空');
    });

    test('长度不符合应返回错误', () => {
        expect(validatePassword('12345')).toBe('密码至少 6 位');
        expect(validatePassword('a'.repeat(129))).toBe('密码不能超过 128 位');
    });
});

describe('handleError - 错误处理', () => {
    test('SQLITE_CONSTRAINT_UNIQUE 应返回 409', () => {
        const err = new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed');
        const result = handleError(err, 'test');
        expect(result.status).toBe(409);
        expect(result.message).toContain('已存在');
    });

    test('SQLITE_CONSTRAINT 应返回 400', () => {
        const err = new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');
        const result = handleError(err, 'test');
        expect(result.status).toBe(400);
        expect(result.message).toContain('约束冲突');
    });

    test('SQLITE_ERROR 应返回 500', () => {
        const err = new Error('SQLITE_ERROR: no such table');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toContain('数据库操作失败');
    });

    test('其他错误应返回 500', () => {
        const err = new Error('Network error');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toContain('服务器异常');
    });

    test('无 message 属性的错误应正确处理', () => {
        const err = { toString: () => 'Custom error' };
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
    });
});

describe('escapeHtml - HTML 转义', () => {
    test('特殊字符应被转义', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#x27;');
    });

    test('正常文本应保持不变', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
        expect(escapeHtml('测试文本')).toBe('测试文本');
        expect(escapeHtml('12345')).toBe('12345');
    });

    test('空值应返回空字符串', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml('')).toBe('');
    });

    test('数字应被转换为字符串', () => {
        expect(escapeHtml(123)).toBe('123');
    });

    test('零值应返回空字符串（falsy 值）', () => {
        expect(escapeHtml(0)).toBe('');
        expect(escapeHtml(false)).toBe('');
    });

    test('对象应被转换为字符串', () => {
        expect(escapeHtml({})).toBe('[object Object]');
    });

    test('复杂 XSS 攻击向量应被转义', () => {
        const xss = '<img src=x onerror=alert(1)>';
        expect(escapeHtml(xss)).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });
});