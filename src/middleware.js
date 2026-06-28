'use strict';

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { JWT_SECRET, IS_PROD, IS_DEV } = require('./config');
const { getDb } = require('./database');

// -------- Helmet 安全头 --------
// 注意：HTTP-only 服务器禁用 HSTS 和 upgrade-insecure-requests，
// 否则浏览器会把子请求强制升级到 https://，导致 443 端口拒绝连接，页面白屏。
function securityHeaders(app) {
    app.use(helmet({
        frameguard: IS_PROD ? { action: 'deny' } : false,
        noSniff: true,
        xssFilter: true,
        ieNoOpen: true,
        hsts: false,
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'default-src': ["'self'"],
                'base-uri': ["'self'"],
                'font-src': ["'self'", 'https:', 'data:'],
                'form-action': ["'self'"],
                'frame-ancestors': ["'self'"],
                'img-src': ["'self'", 'data:'],
                'object-src': ["'none'"],
                'script-src': ["'self'"],
                'script-src-attr': ["'none'"],
                'style-src': ["'self'", 'https:', "'unsafe-inline'"],
                'upgrade-insecure-requests': null,
            },
        },
    }));
}

// -------- 速率限制 --------
function setupRateLimiters() {
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: { error: '请求过于频繁，请稍后再试' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    const generalLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 200,
        message: { error: '请求过于频繁，请稍后再试' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    return { authLimiter, generalLimiter };
}

// -------- 认证中间件 --------
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });

        try {
            const db = getDb();
            const row = db.prepare('SELECT password_changed_at, enabled FROM users WHERE id = ?').get(user.userId);
            if (!row) return res.status(403).json({ error: 'User not found' });
            if (row.enabled === 0) return res.status(403).json({ error: 'Account disabled' });
            if (row.password_changed_at && user.iat) {
                const changedAt = new Date(row.password_changed_at).getTime();
                const issuedAt = user.iat * 1000;
                // 加 1 秒容差：JWT iat 是秒级精度，password_changed_at 是毫秒级 ISO 字符串
                if (issuedAt + 1000 < changedAt) {
                    return res.status(403).json({ error: 'Token expired due to password change' });
                }
            }
        } catch (e) {
            return res.status(500).json({ error: 'Authentication failed' });
        }

        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
}

// -------- 输入验证 --------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,20}$/;

function validateUsername(username) {
    if (!username || typeof username !== 'string') return '用户名不能为空';
    const trimmed = username.trim();
    if (trimmed.length < 2 || trimmed.length > 20) return '用户名长度需在 2-20 个字符之间';
    if (!USERNAME_RE.test(trimmed)) return '用户名只能包含中文、字母、数字、下划线和连字符';
    return null;
}

function validateEmail(email) {
    if (!email || typeof email !== 'string') return '邮箱不能为空';
    if (!EMAIL_RE.test(email.trim())) return '邮箱格式不正确';
    return null;
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') return '密码不能为空';
    if (password.length < 6) return '密码至少 6 位';
    if (password.length > 128) return '密码不能超过 128 位';
    return null;
}

// -------- 统一错误响应 --------
function handleError(err, context) {
    const msg = err.message || String(err);
    if (msg.includes('SQLITE_CONSTRAINT_UNIQUE')) {
        return { status: 409, message: '该数据已存在，请换一个试试' };
    }
    if (msg.includes('SQLITE_CONSTRAINT')) {
        return { status: 400, message: '数据约束冲突，请检查输入' };
    }
    if (msg.includes('SQLITE_ERROR')) {
        return { status: 500, message: '数据库操作失败，请稍后重试' };
    }
    console.error(`[Error] ${context}:`, msg);
    return { status: 500, message: '服务器异常，请稍后重试' };
}

// -------- HTML 转义（防 XSS） --------
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

module.exports = {
    securityHeaders,
    setupRateLimiters,
    authenticateToken,
    requireAdmin,
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml
};
