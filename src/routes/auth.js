'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, addLoginLog } = require('../database');
const { JWT_SECRET, JWT_EXPIRES_IN, POOP_TYPES } = require('../config');
const { authenticateToken, validateUsername, validateEmail, validatePassword, handleError, setupRateLimiters } = require('../middleware');
const { authLimiter } = setupRateLimiters();
const { extractDeviceInfo } = require('../utils');

const router = express.Router();

// -------- 公开接口 --------
router.get('/poop-types', (req, res) => {
    res.json({ types: POOP_TYPES });
});

// -------- 注册 --------
router.post('/register', authLimiter, (req, res) => {
    const db = getDb();
    const { username, email, password } = req.body;

    const vUsername = validateUsername(username);
    if (vUsername) return res.status(400).json({ error: vUsername });
    const vEmail = validateEmail(email);
    if (vEmail) return res.status(400).json({ error: vEmail });
    const vPassword = validatePassword(password);
    if (vPassword) return res.status(400).json({ error: vPassword });

    try {
        if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim())) {
            return res.status(409).json({ error: '该邮箱已被注册' });
        }
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim())) {
            return res.status(409).json({ error: '该用户名已被使用' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const now = new Date().toISOString();
        const result = db.prepare(
            'INSERT INTO users (username, email, password, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)'
        ).run(username.trim(), email.trim(), hashedPassword, now, now);

        const token = jwt.sign(
            { userId: result.lastInsertRowid, username: username.trim(), role: 'user' },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true, token,
            user: { id: result.lastInsertRowid, username: username.trim(), email: email.trim(), role: 'user' }
        });
    } catch (err) {
        const e = handleError(err, 'register');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 登录 --------
router.post('/login', authLimiter, (req, res) => {
    const db = getDb();
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: '请输入账号和密码' });

    const device = extractDeviceInfo(req);

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
        if (!user) {
            addLoginLog(null, device, false, '用户不存在');
            return res.status(401).json({ error: '账号或密码错误' });
        }

        // 检查用户是否被禁用
        if (user.enabled === 0) {
            addLoginLog(user.id, device, false, '用户已被禁用');
            return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
        }

        const valid = bcrypt.compareSync(password, user.password);
        if (!valid) {
            addLoginLog(user.id, device, false, '密码错误');
            return res.status(401).json({ error: '账号或密码错误' });
        }

        const role = user.role || 'user';
        const token = jwt.sign(
            { userId: user.id, username: user.username, role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        addLoginLog(user.id, device, true);

        res.json({
            success: true, token,
            user: { id: user.id, username: user.username, email: user.email, role }
        });
    } catch (err) {
        addLoginLog(null, device, false, err.message);
        const e = handleError(err, 'login');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 需要认证 --------
router.get('/user', authenticateToken, (req, res) => {
    const db = getDb();
    try {
        const user = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: '获取用户信息失败' }); }
});

router.post('/user/password', authenticateToken, (req, res) => {
    const db = getDb();
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写完整信息' });
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });

    try {
        const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });

        const valid = bcrypt.compareSync(oldPassword, user.password);
        if (!valid) return res.status(400).json({ error: '旧密码错误' });

        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        const now = new Date().toISOString();
        db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(hashedPassword, now, req.user.userId);

        res.json({ success: true, message: '密码修改成功' });
    } catch (err) {
        const e = handleError(err, 'changePassword');
        res.status(e.status).json({ error: e.message });
    }
});

module.exports = router;
