'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, addAuditLog } = require('../database');
const { authenticateToken, requireAdmin, handleError } = require('../middleware');
const { queryRecords, computeStats } = require('../records');
const { mapRecord } = require('../utils');

const router = express.Router();

// -------- 用户列表 --------
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    try {
        const users = db.prepare(`
            SELECT u.id, u.username, u.email, u.role, u.enabled, u.created_at,
                   COUNT(r.id) as record_count
            FROM users u
            LEFT JOIN records r ON r.user_id = u.id
            GROUP BY u.id
            ORDER BY u.id DESC
        `).all();
        res.json({ users });
    } catch (err) {
        const e = handleError(err, 'adminGetUsers');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 所有记录 --------
router.get('/records', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    try {
        const { user_id, start, end, poop_type, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (user_id) { conds.push('r.user_id = ?'); params.push(user_id); }
        if (start) { conds.push('r.date >= ?'); params.push(start); }
        if (end) { conds.push('r.date <= ?'); params.push(end); }
        if (poop_type) { conds.push('r.poop_type = ?'); params.push(poop_type); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const total = db.prepare(`SELECT COUNT(*) as c FROM records r ${where}`).get(...params).c;

        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const records = db.prepare(`
            SELECT r.*, u.username as user_username, u.email as user_email
            FROM records r
            LEFT JOIN users u ON u.id = r.user_id
            ${where}
            ORDER BY r.date DESC
            LIMIT ? OFFSET ?
        `).all(...params, lim, off);

        const mapped = records.map(r => ({
            id: r.id,
            userId: r.user_id,
            username: r.user_username,
            email: r.user_email,
            date: r.date,
            notes: r.notes,
            poopType: r.poop_type,
            duration: r.duration || 0,
            status: r.status
        }));

        // 统计
        const typeStats = {};
        let totalRecords = mapped.length;
        let totalDuration = 0, durationCount = 0;
        mapped.forEach(r => {
            if (r.poopType) typeStats[r.poopType] = (typeStats[r.poopType] || 0) + 1;
            if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
        });
        const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

        res.json({
            records: mapped,
            total: totalRecords,
            avgDuration,
            typeStats,
            page: { limit: lim, offset: off, total }
        });
    } catch (err) {
        const e = handleError(err, 'adminGetRecords');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 全局统计 --------
router.get('/stats', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    try {
        const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        const recordCount = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
        const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
        const today = new Date().toISOString().split('T')[0];
        const todayCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE date LIKE ?').get(today + '%').c;

        const typeDist = db.prepare(`
            SELECT poop_type as id, COUNT(*) as count FROM records GROUP BY poop_type
        `).all();

        const trendRows = db.prepare(`
            SELECT substr(date, 1, 10) as day, COUNT(*) as count, COUNT(DISTINCT user_id) as users
            FROM records WHERE date >= date('now', '-29 days')
            GROUP BY substr(date, 1, 10)
            ORDER BY day DESC
        `).all();

        res.json({
            userCount, recordCount, adminCount, todayCount,
            typeDistribution: typeDist,
            trend: trendRows
        });
    } catch (err) {
        const e = handleError(err, 'adminGetStats');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 删除记录 --------
router.delete('/record/:id', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: '无效的记录ID' });
        const record = db.prepare('SELECT id, user_id FROM records WHERE id = ?').get(id);
        if (!record) return res.status(404).json({ error: '记录不存在' });
        db.prepare('DELETE FROM records WHERE id = ?').run(id);
        addAuditLog(req.user.userId, 'DELETE_RECORD', 'record', id, `删除用户${record.user_id}的记录`);
        res.json({ success: true });
    } catch (err) {
        const e = handleError(err, 'adminDeleteRecord');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 重置用户密码 --------
router.post('/user/:id/password', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (isNaN(userId)) return res.status(400).json({ error: '无效的用户ID' });
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: '新密码至少6位' });
    }

    try {
        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });

        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        const now = new Date().toISOString();
        db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(hashedPassword, now, userId);

        addAuditLog(req.user.userId, 'RESET_PASSWORD', 'user', userId, `重置用户 ${user.username} 的密码`);
        res.json({ success: true, message: `用户 ${user.username} 的密码已重置` });
    } catch (err) {
        const e = handleError(err, 'adminResetPassword');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 删除用户 --------
router.delete('/user/:id', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) return res.status(400).json({ error: '无效的用户ID' });

    try {
        const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        if (userId === req.user.userId) return res.status(400).json({ error: '不能删除自己' });
        if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });

        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        addAuditLog(req.user.userId, 'DELETE_USER', 'user', userId, `删除用户: ${user.username}`);
        res.json({ success: true, message: `用户 ${user.username} 已删除` });
    } catch (err) {
        const e = handleError(err, 'adminDeleteUser');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 启用/禁用用户 --------
router.post('/user/:id/toggle', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) return res.status(400).json({ error: '无效的用户ID' });

    try {
        const user = db.prepare('SELECT id, username, role, enabled FROM users WHERE id = ?').get(userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        if (user.role === 'admin') return res.status(400).json({ error: '不能禁用管理员账号' });

        const newEnabled = user.enabled ? 0 : 1;
        const action = newEnabled ? 'ENABLE_USER' : 'DISABLE_USER';
        db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(newEnabled, userId);

        addAuditLog(req.user.userId, action, 'user', userId, `${newEnabled ? '启用' : '禁用'}用户: ${user.username}`);
        res.json({ success: true, message: `用户 ${user.username} 已${newEnabled ? '启用' : '禁用'}`, enabled: newEnabled });
    } catch (err) {
        const e = handleError(err, 'adminToggleUser');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 登录日志 --------
router.get('/login-logs', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    try {
        const { user_id, success, start, end, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (user_id) { conds.push('l.user_id = ?'); params.push(user_id); }
        if (success !== undefined) { conds.push('l.success = ?'); params.push(success); }
        if (start) { conds.push("date(l.created_at, 'localtime') >= ?"); params.push(start); }
        if (end) { conds.push("date(l.created_at, 'localtime') <= ?"); params.push(end); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const total = db.prepare(`SELECT COUNT(*) as c FROM login_logs l ${where}`).get(...params).c;

        const logs = db.prepare(`
            SELECT l.*, u.username as user_username, u.email as user_email
            FROM login_logs l
            LEFT JOIN users u ON u.id = l.user_id
            ${where}
            ORDER BY l.created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, lim, off);

        res.json({
            logs: logs.map(l => ({
                id: l.id, userId: l.user_id, username: l.user_username, email: l.user_email,
                deviceType: l.device_type, deviceBrowser: l.device_browser, deviceOs: l.device_os,
                deviceModel: l.device_model, ip: l.ip, success: !!l.success,
                failReason: l.fail_reason, createdAt: l.created_at
            })),
            page: { limit: lim, offset: off, total }
        });
    } catch (err) {
        const e = handleError(err, 'adminGetLoginLogs');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 审计日志 --------
router.get('/audit-logs', authenticateToken, requireAdmin, (req, res) => {
    const db = getDb();
    try {
        const { action, target_type, start, end, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (action) { conds.push('a.action = ?'); params.push(action); }
        if (target_type) { conds.push('a.target_type = ?'); params.push(target_type); }
        if (start) { conds.push("date(a.created_at, 'localtime') >= ?"); params.push(start); }
        if (end) { conds.push("date(a.created_at, 'localtime') <= ?"); params.push(end); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const total = db.prepare(`SELECT COUNT(*) as c FROM admin_audit_logs a ${where}`).get(...params).c;

        const logs = db.prepare(`
            SELECT a.*, u.username as admin_username
            FROM admin_audit_logs a
            LEFT JOIN users u ON u.id = a.admin_id
            ${where}
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, lim, off);

        res.json({
            logs: logs.map(l => ({
                id: l.id, adminId: l.admin_id, adminUsername: l.admin_username,
                action: l.action, targetType: l.target_type, targetId: l.target_id,
                detail: l.detail, createdAt: l.created_at
            })),
            page: { limit: lim, offset: off, total }
        });
    } catch (err) {
        const e = handleError(err, 'adminGetAuditLogs');
        res.status(e.status).json({ error: e.message });
    }
});

module.exports = router;
