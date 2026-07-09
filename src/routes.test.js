/**
 * 路由模块集成测试 - 补充测试缺口
 * 重点覆盖：导出功能、周视图/月视图、管理员筛选、历史记录
 */

process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const express = require('express');

let app;
let db;
let testUserId;
let adminUserId;
let testToken;
let adminToken;

// 辅助函数
const POOP_TYPES = [
    { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球', category: '便秘' },
    { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状', category: '轻微便秘' },
    { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状', category: '正常' },
    { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状', category: '理想' },
    { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状', category: '缺乏纤维' },
    { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状', category: '轻度腹泻' },
    { id: 7, name: '第7型', emoji: '💧', description: '水状', category: '腹泻' }
];

function toDateKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    const pure = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (pure) return `${pure[1]}-${pure[2]}-${pure[3]}`;
    const withTime = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (withTime) {
        const [, y, mo, d, h, mi, se, ms, tz] = withTime;
        if (!tz) return `${y}-${mo}-${d}`;
        const dt = new Date(Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), se ? parseInt(se, 10) : 0, ms ? parseInt(String(ms).slice(0, 3).padEnd(3, '0'), 10) : 0));
        if (isNaN(dt.getTime())) return `${y}-${mo}-${d}`;
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) {
        const fallback = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return fallback ? `${fallback[1]}-${fallback[2]}-${fallback[3]}` : null;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    const full = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (full) {
        const [, y, mo, d, h, mi, se, ms, tz] = full;
        const year = parseInt(y, 10);
        const month = parseInt(mo, 10) - 1;
        const day = parseInt(d, 10);
        const hour = parseInt(h, 10);
        const minute = parseInt(mi, 10);
        const second = se ? parseInt(se, 10) : 0;
        const milli = ms ? parseInt(String(ms).slice(0, 3).padEnd(3, '0'), 10) : 0;
        if (tz && tz.toUpperCase() === 'Z') {
            const dt = new Date(Date.UTC(year, month, day, hour, minute, second, milli));
            return isNaN(dt.getTime()) ? null : dt;
        }
        if (tz) {
            const sign = tz[0] === '-' ? -1 : 1;
            const body = tz.replace(/[+-:]/g, '');
            const oh = parseInt(body.slice(0, 2), 10) || 0;
            const om = parseInt(body.slice(2, 4), 10) || 0;
            const offsetMs = sign * (oh * 60 + om) * 60 * 1000;
            const dt = new Date(Date.UTC(year, month, day, hour, minute, second, milli) - offsetMs);
            return isNaN(dt.getTime()) ? null : dt;
        }
        const dt = new Date(year, month, day, hour, minute, second, milli);
        return isNaN(dt.getTime()) ? null : dt;
    }
    const dOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dOnly) {
        const dt = new Date(parseInt(dOnly[1], 10), parseInt(dOnly[2], 10) - 1, parseInt(dOnly[3], 10));
        return isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
}

function getWeekRange(date) {
    const d = date instanceof Date ? new Date(date) : parseDateKey(date);
    if (!d || isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    return { start: monday, end: nextMonday };
}

function daysBetween(start, end) {
    const days = [];
    const d = new Date(start);
    d.setHours(0, 0, 0, 0);
    const stop = new Date(end);
    stop.setHours(0, 0, 0, 0);
    while (d < stop) {
        days.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    return days;
}

function calculateStreak(userId) {
    const records = db.prepare("SELECT date FROM records WHERE user_id = ? ORDER BY date DESC").all(userId);
    if (records.length === 0) return 0;
    const days = new Set(records.map(r => toDateKey(r.date)).filter(Boolean));
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 3650; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (days.has(key)) streak++;
        else break;
    }
    return streak;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    jwt.verify(token, 'test-secret-key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
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

function mapRecord(r) {
    return {
        id: r.id,
        userId: r.user_id,
        date: r.date,
        notes: r.notes,
        poopType: r.poop_type,
        duration: r.duration || 0,
        status: r.status
    };
}

function formatDurationSec(seconds) {
    const n = Number(seconds);
    if (!n || n <= 0) return '0 秒';
    const s = Math.floor(n);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
}

beforeAll(() => {
    db = new Database(':memory:');
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            poop_type INTEGER,
            duration INTEGER DEFAULT 0,
            status TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            reminder_hour INTEGER DEFAULT 8,
            reminder_minute INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            ip TEXT,
            user_agent TEXT,
            success INTEGER NOT NULL DEFAULT 0,
            fail_reason TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, 'test-secret-key', { expiresIn: '30d' });

    const adminPassword = bcrypt.hashSync('admin123', 10);
    const adminResult = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', adminPassword, 'admin');
    adminUserId = adminResult.lastInsertRowid;
    adminToken = jwt.sign({ userId: adminUserId, username: 'admin', role: 'admin' }, 'test-secret-key', { expiresIn: '30d' });

    app = express();
    app.use(express.json());

    // ============ 导出路由 ============
    app.get('/api/export', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const format = (req.query.format || 'csv').toString().toLowerCase();
        const range = req.query.range || 'month';
        const start = req.query.start;
        const end = req.query.end;

        const now = new Date();
        let rangeStart, rangeEnd, fileName;
        if (range === 'week') {
            const wr = getWeekRange(now);
            rangeStart = wr.start;
            rangeEnd = wr.end;
            fileName = `weekly_${rangeStart.getFullYear()}${String(rangeStart.getMonth() + 1).padStart(2, '0')}${String(rangeStart.getDate()).padStart(2, '0')}`;
        } else if (range === 'all') {
            rangeStart = null;
            rangeEnd = null;
            fileName = 'all_records';
        } else {
            rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
            rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            fileName = `monthly_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        // 支持自定义日期范围
        if (start) {
            const s = parseDateKey(start);
            if (s) rangeStart = s;
        }
        if (end) {
            const e = parseDateKey(end);
            if (e) { e.setHours(23, 59, 59, 999); rangeEnd = e; }
        }

        const conds = ['user_id = ?'];
        const params = [userId];
        if (rangeStart) {
            conds.push("date(date, 'localtime') >= ?");
            params.push(`${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, '0')}-${String(rangeStart.getDate()).padStart(2, '0')}`);
        }
        if (rangeEnd) {
            conds.push("date(date, 'localtime') < ?");
            params.push(`${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, '0')}-${String(rangeEnd.getDate()).padStart(2, '0')}`);
        }

        const records = db.prepare(`SELECT * FROM records WHERE ${conds.join(' AND ')} ORDER BY date DESC`).all(...params);

        if (format === 'txt') {
            const lines = [`拉屎记录导出 - ${new Date().toLocaleString('zh-CN')}`, `共 ${records.length} 条记录`, ''];
            records.forEach((r, i) => {
                const d = new Date(r.date);
                lines.push(`${i + 1}. ${d.toLocaleString('zh-CN')}`);
                const type = POOP_TYPES.find(t => t.id === r.poop_type);
                lines.push(`   类型: ${type ? `${type.emoji} ${type.name} - ${type.description}` : '未记录'}`);
                lines.push(`   时长: ${r.duration ? formatDurationSec(r.duration) : '未记录'}`);
                if (r.status) lines.push(`   状态: ${r.status}`);
                if (r.notes) lines.push(`   备注: ${r.notes}`);
                lines.push('');
            });
            const totalDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);
            const avgDuration = records.length ? Math.round(totalDuration / records.length) : 0;
            lines.push('===== 统计 =====', `总次数: ${records.length}`, `平均时长: ${formatDurationSec(avgDuration)}`);
            POOP_TYPES.forEach(t => {
                const c = records.filter(r => r.poop_type === t.id).length;
                lines.push(`${t.emoji} ${t.name}: ${c} 次`);
            });
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
            res.send('\uFEFF' + lines.join('\n'));
            return;
        }

        // CSV
        const rows = [['日期', '时间', '类型编号', '类型名称', '描述', '持续时长(秒)', '状态', '备注']];
        records.forEach(r => {
            const d = new Date(r.date);
            const type = POOP_TYPES.find(t => t.id === r.poop_type);
            rows.push([
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
                r.poop_type || '',
                type ? type.name : '',
                type ? type.description : '',
                r.duration || 0,
                r.status || '',
                (r.notes || '').replace(/\s+/g, ' ')
            ]);
        });
        const escape = v => `"${String(v).replace(/"/g, '""')}"`;
        const csv = '\uFEFF' + rows.map(r => r.map(escape).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.csv"`);
        res.send(csv);
    });

    // ============ 历史记录路由 ============
    app.get('/api/history', authenticateToken, (req, res) => {
        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(req.user.userId).map(mapRecord);
        res.json({ records });
    });

    // ============ 周视图路由 ============
    app.get('/api/weekly', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const base = parseDateKey(req.query.date) || new Date();
        const { start, end } = getWeekRange(base);

        const records = db.prepare(`
            SELECT * FROM records 
            WHERE user_id = ? AND date >= ? AND date < ?
            ORDER BY date DESC
        `).all(userId, start.toISOString(), end.toISOString()).map(mapRecord);

        const days = daysBetween(start, end);
        const byDay = {};
        days.forEach(d => {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            byDay[key] = { date: key, items: [], count: 0, totalDuration: 0, typeCounts: {} };
        });

        records.forEach(r => {
            const key = toDateKey(r.date);
            if (key && byDay[key]) {
                byDay[key].items.push(r);
                byDay[key].count++;
                if (r.duration && r.duration > 0) byDay[key].totalDuration += r.duration;
                byDay[key].typeCounts[r.poopType || 0] = (byDay[key].typeCounts[r.poopType || 0] || 0) + 1;
            }
        });

        const dailyList = Object.values(byDay).map(d => ({
            date: d.date, count: d.count,
            avgDuration: d.count ? Math.round(d.totalDuration / d.count) : 0,
            typeCounts: d.typeCounts
        }));

        let totalCount = 0, totalDuration = 0;
        const typeStats = {};
        dailyList.forEach(d => {
            totalCount += d.count;
            totalDuration += d.count * d.avgDuration;
            Object.keys(d.typeCounts).forEach(t => {
                typeStats[t] = (typeStats[t] || 0) + d.typeCounts[t];
            });
        });

        res.json({
            range: { start: start.toISOString(), end: end.toISOString() },
            weekLabel: `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`,
            days: dailyList,
            summary: {
                totalCount,
                avgDuration: totalCount ? Math.round(totalDuration / totalCount) : 0,
                avgPerDay: Math.round((totalCount / 7) * 10) / 10,
                typeStats
            },
            records
        });
    });

    // ============ 月视图路由 ============
    app.get('/api/monthly', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        let base;
        if (req.query.date && /^\d{4}-\d{1,2}$/.test(req.query.date)) {
            const [y, m] = req.query.date.split('-').map(Number);
            base = new Date(y, m - 1, 1);
        } else {
            base = new Date();
        }

        const start = new Date(base.getFullYear(), base.getMonth(), 1);
        const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);

        const records = db.prepare(`
            SELECT * FROM records 
            WHERE user_id = ? AND date >= ? AND date < ?
            ORDER BY date DESC
        `).all(userId, start.toISOString(), end.toISOString()).map(mapRecord);

        const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const byDay = {};
        for (let i = 1; i <= daysInMonth; i++) {
            const key = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            byDay[key] = { date: key, count: 0, totalDuration: 0, typeCounts: {} };
        }

        records.forEach(r => {
            const key = toDateKey(r.date);
            if (key && byDay[key]) {
                byDay[key].count++;
                if (r.duration && r.duration > 0) byDay[key].totalDuration += r.duration;
                byDay[key].typeCounts[r.poopType || 0] = (byDay[key].typeCounts[r.poopType || 0] || 0) + 1;
            }
        });

        const dailyList = Object.values(byDay).map(d => ({
            date: d.date, count: d.count,
            avgDuration: d.count ? Math.round(d.totalDuration / d.count) : 0,
            typeCounts: d.typeCounts
        }));

        let currentCount = 0, totalDuration = 0;
        const typeStats = {};
        dailyList.forEach(d => {
            currentCount += d.count;
            totalDuration += d.count * d.avgDuration;
            Object.keys(d.typeCounts).forEach(t => {
                typeStats[t] = (typeStats[t] || 0) + d.typeCounts[t];
            });
        });

        res.json({
            month: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`,
            range: { start: start.toISOString(), end: end.toISOString() },
            days: dailyList,
            summary: {
                totalCount: currentCount,
                avgDuration: currentCount ? Math.round(totalDuration / currentCount) : 0,
                avgPerDay: Math.round((currentCount / daysInMonth) * 10) / 10,
                typeStats
            },
            records
        });
    });

    // ============ 管理员记录查询路由 ============
    app.get('/api/admin/records', authenticateToken, requireAdmin, (req, res) => {
        const { user_id, start, end, poop_type, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (user_id) { conds.push('user_id = ?'); params.push(user_id); }
        if (start) { conds.push("date(date, 'localtime') >= ?"); params.push(start); }
        if (end) { conds.push("date(date, 'localtime') <= ?"); params.push(end); }
        if (poop_type) { conds.push('poop_type = ?'); params.push(poop_type); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const total = db.prepare(`SELECT COUNT(*) as c FROM records ${where}`).get(...params).c;

        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const records = db.prepare(`
            SELECT r.*, u.username as user_username, u.email as user_email
            FROM records r
            LEFT JOIN users u ON u.id = r.user_id
            ${where}
            ORDER BY r.date DESC
            LIMIT ? OFFSET ?
        `).all(...params, lim, off).map(r => ({
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

        const typeStats = {};
        let totalRecords = records.length;
        let totalDuration = 0, durationCount = 0;
        records.forEach(r => {
            if (r.poopType) typeStats[r.poopType] = (typeStats[r.poopType] || 0) + 1;
            if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
        });
        const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

        res.json({
            records,
            total: totalRecords,
            avgDuration,
            typeStats,
            page: { limit: lim, offset: off, total }
        });
    });

    // ============ 管理员登录日志路由 ============
    app.get('/api/admin/login-logs', authenticateToken, requireAdmin, (req, res) => {
        const { user_id, success, start, end, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (user_id) { conds.push('user_id = ?'); params.push(user_id); }
        if (success !== undefined) { conds.push('success = ?'); params.push(success === 'true' ? 1 : 0); }
        if (start) { conds.push("date(created_at, 'localtime') >= ?"); params.push(start); }
        if (end) { conds.push("date(created_at, 'localtime') <= ?"); params.push(end); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const total = db.prepare(`SELECT COUNT(*) as c FROM login_logs ${where}`).get(...params).c;
        const logs = db.prepare(`
            SELECT l.*, u.username as user_username
            FROM login_logs l
            LEFT JOIN users u ON u.id = l.user_id
            ${where}
            ORDER BY l.created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, lim, off);

        res.json({
            logs: logs.map(l => ({
                id: l.id,
                userId: l.user_id,
                username: l.user_username,
                deviceType: l.device_type,
                success: !!l.success,
                createdAt: l.created_at
            })),
            page: { limit: lim, offset: off, total }
        });
    });

    // ============ 管理员审计日志路由 ============
    app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, (req, res) => {
        const { action, target_type, start, end, limit, offset } = req.query;
        const conds = [];
        const params = [];
        if (action) { conds.push('action = ?'); params.push(action); }
        if (target_type) { conds.push('target_type = ?'); params.push(target_type); }
        if (start) { conds.push("date(created_at, 'localtime') >= ?"); params.push(start); }
        if (end) { conds.push("date(created_at, 'localtime') <= ?"); params.push(end); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const total = db.prepare(`SELECT COUNT(*) as c FROM admin_audit_logs ${where}`).get(...params).c;
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
                id: l.id,
                adminId: l.admin_id,
                adminUsername: l.admin_username,
                action: l.action,
                targetType: l.target_type,
                targetId: l.target_id,
                createdAt: l.created_at
            })),
            page: { limit: lim, offset: off, total }
        });
    });
});

afterAll(() => {
    db.close();
});

// ============ 导出功能测试 ============
describe('导出 API - 数据格式与范围', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        // 创建测试数据
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300 + i * 60, '正常', `备注${i}`, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('CSV导出应包含BOM头和正确格式', async () => {
        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.text.startsWith('\uFEFF')).toBe(true);
        // CSV字段会被引号包裹，这是正常格式
        expect(res.text).toContain('"日期"');
        expect(res.text).toContain('"第4型"');
    });

    test('TXT导出应包含格式化的统计信息', async () => {
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.text).toContain('拉屎记录导出');
        expect(res.text).toContain('===== 统计 =====');
        expect(res.text).toContain('总次数: 3');
        expect(res.text).toContain('平均时长');
        expect(res.text).toContain('🍌');
    });

    test('周范围导出应正确计算日期范围', async () => {
        const res = await request(app).get('/api/export?range=week')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('weekly_');
    });

    test('月范围导出应正确计算日期范围', async () => {
        const res = await request(app).get('/api/export?range=month')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        const now = new Date();
        expect(res.headers['content-disposition']).toContain(`monthly_${now.getFullYear()}`);
    });

    test('全部导出应返回所有记录', async () => {
        const res = await request(app).get('/api/export?range=all')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('all_records');
        expect(res.text).toContain('备注0');
        expect(res.text).toContain('备注1');
        expect(res.text).toContain('备注2');
    });

    test('自定义日期范围导出应正确筛选', async () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        
        const res = await request(app).get(`/api/export?start=${startStr}&end=${endStr}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
    });

    test('无记录导出应返回空统计', async () => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('共 0 条记录');
        expect(res.text).toContain('总次数: 0');
        expect(res.text).toContain('平均时长: 0 秒');
    });

    test('CSV特殊字符应正确转义', async () => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        db.prepare('INSERT INTO records (user_id, date, poop_type, notes, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, '备注含"引号"和,逗号', new Date().toISOString()
        );
        
        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('"备注含""引号""和,逗号"');
    });

    test('未认证导出应返回401', async () => {
        const res = await request(app).get('/api/export');
        expect(res.status).toBe(401);
    });
});

// ============ 历史记录测试 ============
describe('历史记录 API', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, '测试记录1', '2024-01-15T08:30:00'
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-14T10:00:00', 3, 240, '测试记录2', '2024-01-14T10:00:00'
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回用户所有历史记录', async () => {
        const res = await request(app).get('/api/history')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBe(2);
        expect(res.body.records[0].notes).toBe('测试记录1');
        expect(res.body.records[1].notes).toBe('测试记录2');
    });

    test('记录应按日期降序排序', async () => {
        const res = await request(app).get('/api/history')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records[0].date).toBe('2024-01-15T08:30:00');
        expect(res.body.records[1].date).toBe('2024-01-14T10:00:00');
    });

    test('无记录应返回空数组', async () => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        
        const res = await request(app).get('/api/history')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toEqual([]);
    });

    test('未认证应返回401', async () => {
        const res = await request(app).get('/api/history');
        expect(res.status).toBe(401);
    });
});

// ============ 周视图测试 ============
describe('周视图 API - 日期计算与统计', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        // 创建本周的记录
        const now = new Date();
        const { start } = getWeekRange(now);
        for (let i = 0; i < 3; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4 - i, 300 + i * 60, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回本周完整数据', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
        expect(res.body.days).toBeDefined();
        expect(res.body.summary).toBeDefined();
        expect(res.body.records.length).toBe(3);
    });

    test('天数应覆盖完整周范围（7天）', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.days.length).toBe(7);
    });

    test('统计汇总应正确计算', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(3);
        expect(res.body.summary.avgDuration).toBe(Math.round((300 + 360 + 420) / 3));
        expect(res.body.summary.typeStats).toBeDefined();
        expect(res.body.summary.typeStats['4']).toBe(1);
        expect(res.body.summary.typeStats['3']).toBe(1);
        expect(res.body.summary.typeStats['2']).toBe(1);
    });

    test('指定日期应返回对应周', async () => {
        const res = await request(app).get('/api/weekly?date=2024-01-15')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.weekLabel).toContain('2024');
    });

    test('每日统计应正确聚合', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        const daysWithRecords = res.body.days.filter(d => d.count > 0);
        expect(daysWithRecords.length).toBe(3);
        daysWithRecords.forEach(d => {
            expect(d.avgDuration).toBeGreaterThan(0);
            expect(d.typeCounts).toBeDefined();
        });
    });

    test('平均每日次数应正确计算', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.avgPerDay).toBeCloseTo(3 / 7, 1);
    });

    test('未认证应返回401', async () => {
        const res = await request(app).get('/api/weekly');
        expect(res.status).toBe(401);
    });
});

// ============ 月视图测试 ============
describe('月视图 API - 日期范围与聚合', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        // 创建本月的记录
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        for (let i = 0; i < 5; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i * 3);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), (i % 7) + 1, 300 + i * 60, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回本月完整数据', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBeDefined();
        expect(res.body.range).toBeDefined();
        expect(res.body.days).toBeDefined();
        expect(res.body.summary).toBeDefined();
        expect(res.body.records.length).toBe(5);
    });

    test('天数应覆盖整月', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        expect(res.body.days.length).toBe(daysInMonth);
    });

    test('月标签格式应正确', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        const now = new Date();
        expect(res.body.month).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    });

    test('指定月份应返回对应数据', async () => {
        const res = await request(app).get('/api/monthly?date=2024-06')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBe('2024-06');
        expect(res.body.days.length).toBe(30); // 2024年6月有30天
    });

    test('统计汇总应正确计算', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(5);
        expect(res.body.summary.avgDuration).toBeDefined();
        expect(res.body.summary.typeStats).toBeDefined();
    });

    test('每日平均次数应正确计算', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        expect(res.body.summary.avgPerDay).toBeCloseTo(5 / daysInMonth, 1);
    });

    test('无记录月份应返回空统计', async () => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(0);
        expect(res.body.summary.avgDuration).toBe(0);
    });

    test('未认证应返回401', async () => {
        const res = await request(app).get('/api/monthly');
        expect(res.status).toBe(401);
    });
});

// ============ 管理员记录筛选测试 ============
describe('管理员记录筛选 API - 多参数查询', () => {
    let otherUserId;

    beforeEach(() => {
        // 清理所有表数据
        db.prepare('DELETE FROM records').run();
        db.prepare('DELETE FROM login_logs').run();
        db.prepare('DELETE FROM admin_audit_logs').run();
        db.prepare('DELETE FROM users WHERE id NOT IN (?, ?)').run(testUserId, adminUserId);
        
        // 创建其他用户（使用不同的邮箱避免冲突）
        const timestamp = Date.now();
        const otherPassword = bcrypt.hashSync('other123', 10);
        otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(`otheruser${timestamp}`, `other${timestamp}@test.com`, otherPassword).lastInsertRowid;

        // 为两个用户创建记录
        const now = new Date();
        for (let i = 0; i < 5; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), i + 1, 300, d.toISOString()
            );
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                otherUserId, d.toISOString(), 7 - i, 240, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records').run();
        db.prepare('DELETE FROM login_logs').run();
        db.prepare('DELETE FROM admin_audit_logs').run();
        db.prepare('DELETE FROM users WHERE id NOT IN (?, ?)').run(testUserId, adminUserId);
    });

    test('按用户筛选应返回指定用户记录', async () => {
        const res = await request(app).get(`/api/admin/records?user_id=${testUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.userId === testUserId)).toBe(true);
        expect(res.body.records.length).toBe(5);
    });

    test('按日期范围筛选应正确', async () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        
        const res = await request(app).get(`/api/admin/records?start=${startStr}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.page.total).toBeLessThan(10);
    });

    test('按大便类型筛选应正确', async () => {
        const res = await request(app).get('/api/admin/records?poop_type=4')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.poopType === 4)).toBe(true);
    });

    test('多参数组合筛选应正确', async () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        
        const res = await request(app).get(`/api/admin/records?user_id=${testUserId}&start=${startStr}&poop_type=4`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.userId === testUserId)).toBe(true);
    });

    test('分页参数应正确应用', async () => {
        const res = await request(app).get('/api/admin/records?limit=3&offset=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(3);
        expect(res.body.page.limit).toBe(3);
        expect(res.body.page.offset).toBe(0);
        expect(res.body.page.total).toBe(10);
    });

    test('分页边界应正确处理', async () => {
        const res = await request(app).get('/api/admin/records?limit=500&offset=5')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.page.limit).toBe(500);
        expect(res.body.page.offset).toBe(5);
    });

    test('统计信息应正确计算', async () => {
        const res = await request(app).get('/api/admin/records')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(10);
        expect(res.body.avgDuration).toBeDefined();
        expect(res.body.typeStats).toBeDefined();
    });

    test('记录应包含用户信息', async () => {
        const res = await request(app).get('/api/admin/records')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records[0].username).toBeDefined();
        expect(res.body.records[0].email).toBeDefined();
    });

    test('普通用户无权限应返回403', async () => {
        const res = await request(app).get('/api/admin/records')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
    });

    test('未认证应返回401', async () => {
        const res = await request(app).get('/api/admin/records');
        expect(res.status).toBe(401);
    });
});

// ============ 管理员登录日志筛选测试 ============
describe('管理员登录日志筛选 API', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM login_logs').run();
        // 创建登录日志
        const now = new Date();
        db.prepare('INSERT INTO login_logs (user_id, success, fail_reason, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, 1, null, now.toISOString()
        );
        db.prepare('INSERT INTO login_logs (user_id, success, fail_reason, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, 0, '密码错误', new Date(now.getTime() - 3600000).toISOString()
        );
        db.prepare('INSERT INTO login_logs (user_id, success, fail_reason, created_at) VALUES (?, ?, ?, ?)').run(
            adminUserId, 1, null, new Date(now.getTime() - 7200000).toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM login_logs').run();
    });

    test('按用户筛选应正确', async () => {
        const res = await request(app).get(`/api/admin/login-logs?user_id=${testUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.userId === testUserId)).toBe(true);
    });

    test('按成功状态筛选应正确', async () => {
        const res = await request(app).get('/api/admin/login-logs?success=true')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.success === true)).toBe(true);
    });

    test('筛选参数应被正确接受', async () => {
        const res = await request(app).get('/api/admin/login-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('分页参数应正确应用', async () => {
        const res = await request(app).get('/api/admin/login-logs?limit=2&offset=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBeLessThanOrEqual(2);
        expect(res.body.page.limit).toBe(2);
    });

    test('日志应包含设备信息', async () => {
        const res = await request(app).get('/api/admin/login-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs[0].deviceType).toBeDefined();
        expect(res.body.logs[0].success).toBeDefined();
    });

    test('普通用户无权限应返回403', async () => {
        const res = await request(app).get('/api/admin/login-logs')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
    });
});

// ============ 管理员审计日志筛选测试 ============
describe('管理员审计日志筛选 API', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM admin_audit_logs').run();
        // 创建审计日志
        const now = new Date();
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            adminUserId, 'DELETE_USER', 'user', testUserId, '删除用户', now.toISOString()
        );
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            adminUserId, 'RESET_PASSWORD', 'user', testUserId, '重置密码', new Date(now.getTime() - 3600000).toISOString()
        );
        db.prepare('INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            adminUserId, 'DISABLE_USER', 'user', testUserId, '禁用用户', new Date(now.getTime() - 7200000).toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM admin_audit_logs').run();
    });

    test('按操作类型筛选应正确', async () => {
        const res = await request(app).get('/api/admin/audit-logs?action=DELETE_USER')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.action === 'DELETE_USER')).toBe(true);
    });

    test('按目标类型筛选应正确', async () => {
        const res = await request(app).get('/api/admin/audit-logs?target_type=user')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.targetType === 'user')).toBe(true);
    });

    test('筛选参数应被正确接受', async () => {
        const res = await request(app).get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('分页参数应正确应用', async () => {
        const res = await request(app).get('/api/admin/audit-logs?limit=2&offset=0')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.length).toBeLessThanOrEqual(2);
        expect(res.body.page.limit).toBe(2);
    });

    test('日志应包含管理员信息', async () => {
        const res = await request(app).get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs[0].adminId).toBeDefined();
        expect(res.body.logs[0].adminUsername).toBeDefined();
        expect(res.body.logs[0].action).toBeDefined();
    });

    test('多参数组合筛选应正确', async () => {
        const res = await request(app).get('/api/admin/audit-logs?action=DELETE_USER&target_type=user')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.logs.every(l => l.action === 'DELETE_USER' && l.targetType === 'user')).toBe(true);
    });

    test('普通用户无权限应返回403', async () => {
        const res = await request(app).get('/api/admin/audit-logs')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
    });
});