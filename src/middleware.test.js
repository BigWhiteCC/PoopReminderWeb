'use strict';

process.env.JWT_SECRET = 'test-secret-key';

const { validateUsername, validateEmail, validatePassword, handleError, escapeHtml } = require('./middleware');

describe('middleware.js - 输入验证', () => {
    describe('validateUsername - 用户名验证', () => {
        test('有效用户名应返回 null', () => {
            expect(validateUsername('testuser')).toBeNull();
            expect(validateUsername('中文用户名')).toBeNull();
            expect(validateUsername('user_123')).toBeNull();
            expect(validateUsername('user-name')).toBeNull();
            expect(validateUsername('a'.repeat(2))).toBeNull();
            expect(validateUsername('a'.repeat(20))).toBeNull();
        });

        test('空用户名应返回错误', () => {
            expect(validateUsername('')).toContain('不能为空');
            expect(validateUsername(null)).toContain('不能为空');
            expect(validateUsername(undefined)).toContain('不能为空');
            expect(validateUsername(123)).toContain('不能为空');
        });

        test('长度不足应返回错误', () => {
            expect(validateUsername('a')).toContain('2-20');
        });

        test('长度过长应返回错误', () => {
            expect(validateUsername('a'.repeat(21))).toContain('2-20');
        });

        test('包含非法字符应返回错误', () => {
            expect(validateUsername('user@name')).toContain('只能包含');
            expect(validateUsername('user#name')).toContain('只能包含');
            expect(validateUsername('user name')).toContain('只能包含');
            expect(validateUsername('user*name')).toContain('只能包含');
        });

        test('前后空格应被忽略', () => {
            expect(validateUsername('  testuser  ')).toBeNull();
        });
    });

    describe('validateEmail - 邮箱验证', () => {
        test('有效邮箱应返回 null', () => {
            expect(validateEmail('test@example.com')).toBeNull();
            expect(validateEmail('user.name@domain.org')).toBeNull();
            expect(validateEmail('user+tag@example.co.uk')).toBeNull();
        });

        test('空邮箱应返回错误', () => {
            expect(validateEmail('')).toContain('不能为空');
            expect(validateEmail(null)).toContain('不能为空');
            expect(validateEmail(undefined)).toContain('不能为空');
            expect(validateEmail(123)).toContain('不能为空');
        });

        test('无效格式应返回错误', () => {
            expect(validateEmail('invalid')).toContain('格式不正确');
            expect(validateEmail('@example.com')).toContain('格式不正确');
            expect(validateEmail('test@')).toContain('格式不正确');
            expect(validateEmail('test@.com')).toContain('格式不正确');
            expect(validateEmail('test@com')).toContain('格式不正确');
            expect(validateEmail('test @example.com')).toContain('格式不正确');
            expect(validateEmail('test@example .com')).toContain('格式不正确');
        });

        test('前后空格应被忽略', () => {
            expect(validateEmail('  test@example.com  ')).toBeNull();
        });
    });

    describe('validatePassword - 密码验证', () => {
        test('有效密码应返回 null', () => {
            expect(validatePassword('password123')).toBeNull();
            expect(validatePassword('a'.repeat(6))).toBeNull();
            expect(validatePassword('a'.repeat(128))).toBeNull();
        });

        test('空密码应返回错误', () => {
            expect(validatePassword('')).toContain('不能为空');
            expect(validatePassword(null)).toContain('不能为空');
            expect(validatePassword(undefined)).toContain('不能为空');
            expect(validatePassword(123)).toContain('不能为空');
        });

        test('长度不足应返回错误', () => {
            expect(validatePassword('12345')).toContain('至少 6 位');
        });

        test('长度过长应返回错误', () => {
            expect(validatePassword('a'.repeat(129))).toContain('不能超过 128 位');
        });
    });
});

describe('middleware.js - 错误处理', () => {
    describe('handleError - 统一错误处理', () => {
        test('SQLITE_CONSTRAINT_UNIQUE 应返回 409', () => {
            const result = handleError(new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed'), 'test');
            expect(result.status).toBe(409);
            expect(result.message).toContain('已存在');
        });

        test('SQLITE_CONSTRAINT 应返回 400', () => {
            const result = handleError(new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'), 'test');
            expect(result.status).toBe(400);
            expect(result.message).toContain('约束冲突');
        });

        test('SQLITE_ERROR 应返回 500', () => {
            const result = handleError(new Error('SQLITE_ERROR: no such table'), 'test');
            expect(result.status).toBe(500);
            expect(result.message).toContain('数据库操作失败');
        });

        test('其他错误应返回 500', () => {
            const result = handleError(new Error('未知错误'), 'test');
            expect(result.status).toBe(500);
            expect(result.message).toContain('服务器异常');
        });

        test('非 Error 对象应被转换为字符串', () => {
            const result = handleError('字符串错误', 'test');
            expect(result.status).toBe(500);
        });
    });
});

describe('middleware.js - XSS 防护', () => {
    describe('escapeHtml - HTML 转义', () => {
        test('普通文本应保持不变', () => {
            expect(escapeHtml('Hello World')).toBe('Hello World');
            expect(escapeHtml('12345')).toBe('12345');
        });

        test('特殊字符应被转义', () => {
            expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
            expect(escapeHtml('&')).toBe('&amp;');
            expect(escapeHtml('>')).toBe('&gt;');
            expect(escapeHtml('"')).toBe('&quot;');
            expect(escapeHtml("'")).toBe('&#x27;');
        });

        test('综合 XSS 攻击应被转义', () => {
            const xss = '<script>alert("XSS")</script>';
            const escaped = escapeHtml(xss);
            expect(escaped).not.toContain('<script>');
            expect(escaped).not.toContain('</script>');
            expect(escaped).not.toContain('">');
        });

        test('空值应返回空字符串', () => {
            expect(escapeHtml(null)).toBe('');
            expect(escapeHtml(undefined)).toBe('');
            expect(escapeHtml('')).toBe('');
        });

        test('非字符串输入应被转换', () => {
            expect(escapeHtml(123)).toBe('123');
            expect(escapeHtml({})).toBe('[object Object]');
        });
    });
});