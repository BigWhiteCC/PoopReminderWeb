process.env.JWT_SECRET = 'test-secret-key';

const express = require('express');
const request = require('supertest');
const {
    securityHeaders,
    setupRateLimiters,
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

describe('securityHeaders - 安全头配置', () => {
    test('应正确设置安全头', async () => {
        const app = express();
        securityHeaders(app);
        app.get('/', (req, res) => res.send('OK'));

        const res = await request(app).get('/');
        expect(res.headers['x-dns-prefetch-control']).toBeDefined();
        expect(res.headers['x-xss-protection']).toBeDefined();
        expect(res.headers['x-content-type-options']).toBeDefined();
        expect(res.headers['content-security-policy']).toBeDefined();
    });

    test('CSP 应包含 default-src self', async () => {
        const app = express();
        securityHeaders(app);
        app.get('/', (req, res) => res.send('OK'));

        const res = await request(app).get('/');
        expect(res.headers['content-security-policy']).toContain("'self'");
    });

    test('CSP 应包含 script-src self', async () => {
        const app = express();
        securityHeaders(app);
        app.get('/', (req, res) => res.send('OK'));

        const res = await request(app).get('/');
        expect(res.headers['content-security-policy']).toContain('script-src');
    });

    test('应禁用 HSTS', async () => {
        const app = express();
        securityHeaders(app);
        app.get('/', (req, res) => res.send('OK'));

        const res = await request(app).get('/');
        expect(res.headers['strict-transport-security']).toBeUndefined();
    });

    test('应禁用 upgrade-insecure-requests', async () => {
        const app = express();
        securityHeaders(app);
        app.get('/', (req, res) => res.send('OK'));

        const res = await request(app).get('/');
        expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    });
});

describe('setupRateLimiters - 速率限制配置', () => {
    test('应返回 authLimiter 和 generalLimiter', () => {
        const limiters = setupRateLimiters();
        expect(limiters.authLimiter).toBeDefined();
        expect(limiters.generalLimiter).toBeDefined();
    });

    test('authLimiter 应限制请求频率', async () => {
        const app = express();
        const { authLimiter } = setupRateLimiters();
        app.use(express.json());
        app.post('/login', authLimiter, (req, res) => res.json({ success: true }));

        for (let i = 0; i < 10; i++) {
            const res = await request(app).post('/login').send({ email: 'test', password: 'test' });
            expect(res.status).toBe(200);
        }

        const blockedRes = await request(app).post('/login').send({ email: 'test', password: 'test' });
        expect(blockedRes.status).toBe(429);
    });

    test('generalLimiter 应允许更多请求', async () => {
        const app = express();
        const { generalLimiter } = setupRateLimiters();
        app.use(generalLimiter);
        app.get('/test', (req, res) => res.send('OK'));

        for (let i = 0; i < 50; i++) {
            const res = await request(app).get('/test');
            expect(res.status).toBe(200);
        }
    });
});