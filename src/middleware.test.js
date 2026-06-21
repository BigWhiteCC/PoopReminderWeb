'use strict';

/**
 * src/middleware.js 单元测试
 * 重点覆盖：输入验证、错误处理、XSS 防护、认证逻辑
 */

const {
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml
} = require('./middleware');

// ============ validateUsername 测试 ============
describe('validateUsername - 用户名验证', () => {
    test('有效用户名应通过', () => {
        expect(validateUsername('testuser')).toBeNull();
        expect(validateUsername('测试用户')).toBeNull();
        expect(validateUsername('user_123')).toBeNull();
        expect(validateUsername('user-name')).toBeNull();
    });

    test('空用户名应报错', () => {
        expect(validateUsername(null)).toBe('用户名不能为空');
        expect(validateUsername(undefined)).toBe('用户名不能为空');
        expect(validateUsername('')).toBe('用户名不能为空');
    });

    test('非字符串应报错', () => {
        expect(validateUsername(123)).toBe('用户名不能为空');
        expect(validateUsername({})).toBe('用户名不能为空');
    });

    test('长度不足应报错', () => {
        expect(validateUsername('a')).toBe('用户名长度需在 2-20 个字符之间');
        expect(validateUsername('ab')).toBeNull(); // 最小长度 2
    });

    test('长度超限应报错', () => {
        expect(validateUsername('a'.repeat(21))).toBe('用户名长度需在 2-20 个字符之间');
        expect(validateUsername('a'.repeat(20))).toBeNull(); // 最大长度 20
    });

    test('非法字符应报错', () => {
        expect(validateUsername('user@name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user!name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
    });

    test('空格会被 trim', () => {
        expect(validateUsername('  testuser  ')).toBeNull();
    });
});

// ============ validateEmail 测试 ============
describe('validateEmail - 箱验证', () => {
    test('有效邮箱应通过', () => {
        expect(validateEmail('test@example.com')).toBeNull();
        expect(validateEmail('user.name@domain.co')).toBeNull();
        expect(validateEmail('a@b.c')).toBeNull();
    });

    test('空邮箱应报错', () => {
        expect(validateEmail(null)).toBe('邮箱不能为空');
        expect(validateEmail(undefined)).toBe('邮箱不能为空');
        expect(validateEmail('')).toBe('邮箱不能为空');
    });

    test('非字符串应报错', () => {
        expect(validateEmail(123)).toBe('邮箱不能为空');
    });

    test('格式不正确应报错', () => {
        expect(validateEmail('invalid')).toBe('邮箱格式不正确');
        expect(validateEmail('test@')).toBe('邮箱格式不正确');
        expect(validateEmail('@domain.com')).toBe('邮箱格式不正确');
        expect(validateEmail('test@domain')).toBe('邮箱格式不正确');
        expect(validateEmail('test domain.com')).toBe('邮箱格式不正确');
    });

    test('空格会被 trim', () => {
        expect(validateEmail('  test@example.com  ')).toBeNull();
    });
});

// ============ validatePassword 测试 ============
describe('validatePassword - 密码验证', () => {
    test('有效密码应通过', () => {
        expect(validatePassword('123456')).toBeNull();
        expect(validatePassword('password123')).toBeNull();
        expect(validatePassword('a'.repeat(128))).toBeNull();
    });

    test('空密码应报错', () => {
        expect(validatePassword(null)).toBe('密码不能为空');
        expect(validatePassword(undefined)).toBe('密码不能为空');
        expect(validatePassword('')).toBe('密码不能为空');
    });

    test('非字符串应报错', () => {
        expect(validatePassword(123456)).toBe('密码不能为空');
    });

    test('长度不足应报错', () => {
        expect(validatePassword('12345')).toBe('密码至少 6 位');
        expect(validatePassword('123456')).toBeNull(); // 最小 6 位
    });

    test('长度超限应报错', () => {
        expect(validatePassword('a'.repeat(129))).toBe('密码不能超过 128 位');
        expect(validatePassword('a'.repeat(128))).toBeNull(); // 最大 128 位
    });
});

// ============ handleError 测试 ============
describe('handleError - 错误处理', () => {
    test('UNIQUE 约束冲突返回 409', () => {
        const err = new Error('SQLITE_CONSTRAINT_UNIQUE: users.email');
        const result = handleError(err, 'test');
        expect(result.status).toBe(409);
        expect(result.message).toContain('已存在');
    });

    test('一般约束冲突返回 400', () => {
        const err = new Error('SQLITE_CONSTRAINT: foreign key');
        const result = handleError(err, 'test');
        expect(result.status).toBe(400);
        expect(result.message).toContain('约束冲突');
    });

    test('SQL 错误返回 500', () => {
        const err = new Error('SQLITE_ERROR: no such table');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toContain('数据库操作失败');
    });

    test('未知错误返回 500', () => {
        const err = new Error('Unknown error');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toContain('服务器异常');
    });

    test('空错误对象', () => {
        const result = handleError({}, 'test');
        expect(result.status).toBe(500);
    });
});

// ============ escapeHtml 测试 ============
describe('escapeHtml - XSS 防护', () => {
    test('HTML 标签应被转义', () => {
        expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(escapeHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
    });

    test('引号应被转义', () => {
        expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
        expect(escapeHtml("'test'")).toBe('&#x27;test&#x27;');
    });

    test('& 符号应被转义', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('组合攻击应被转义', () => {
        expect(escapeHtml('<img src="x" onerror="alert(1)">')).toBe('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
    });

    test('空值返回空字符串', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml('')).toBe('');
    });

    test('正常文本不变', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
        expect(escapeHtml('测试文本 123')).toBe('测试文本 123');
    });

    test('数字会被转为字符串', () => {
        expect(escapeHtml(123)).toBe('123');
    });
});