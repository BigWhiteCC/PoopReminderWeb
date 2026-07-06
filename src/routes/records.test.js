/**
 * 记录路由深度测试
 * 重点覆盖：周视图、月视图、导出功能、复杂筛选逻辑、数据聚合
 */

process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const express = require('express');
const cors = require('cors');

let app;
let db;
let testUserId;
let testToken;

// 模拟 POOP_TYPES 常量
const POOP_TYPES = [
    { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球', category: '便秘' },
    { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状', category: '轻微便秘' },
    { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状', category: '正常' },
    { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状', category: '理想' },
    { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状', category: '缺乏纤维' },
    { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状', category: '轻度腹泻' },
    { id: 7, name: '第7型', emoji: '💧', description: '水状', category: '腹泻' }
];

beforeAll(() => {
    // 创建内存数据库
    db = new Database(':memory:');
    
    // 初始化表结构
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            poop_type INTEGER,
            duration INTEGER DEFAULT 0,
            status TEXT,
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            device_ip TEXT,
            device_user_agent TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            reminder_hour INTEGER DEFAULT 8,
            reminder_minute INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
        CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
    `);

    // 创建测试用户
    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', hashedPassword);
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, 'test-secret-key', { expiresIn: '30d' });

    // 创建 Express 应用
    app = express();
    app.use(cors());
    app.use(express.json());

    // 认证中间件
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

    // 日期工具函数（从 utils.js 复制）
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
    
    // 将 getWeekRange 导出供测试使用
    app.locals.getWeekRange = getWeekRange;

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

    function getWeekNumber(d) {
        const target = new Date(d.valueOf());
        const dayNr = (d.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }

    function mapRecord(r) {
        return {
            id: r.id,
            userId: r.user_id,
            date: r.date,
            notes: r.notes,
            poopType: r.poop_type,
            duration: r.duration || 0,
            status: r.status,
            device: {
                type: r.device_type, browser: r.device_browser, os: r.device_os,
                model: r.device_model, ip: r.device_ip, userAgent: r.device_user_agent
            }
        };
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    function extractDeviceInfo(req) {
        const userAgent = req.headers['user-agent'] || '';
        let deviceType = '桌面电脑';
        let browser = '未知浏览器';
        let os = '未知系统';
        let model = '';
        if (/Tablet|iPad/i.test(userAgent)) deviceType = '平板';
        else if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) deviceType = '移动设备';
        if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) browser = 'Chrome';
        else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari';
        else if (/Firefox/i.test(userAgent)) browser = 'Firefox';
        else if (/Edg/i.test(userAgent)) browser = 'Edge';
        if (/Android/i.test(userAgent)) os = 'Android';
        else if (/iPhone|iPad|iPod/i.test(userAgent)) os = 'iOS';
        else if (/Windows NT 10/i.test(userAgent)) os = 'Windows 10/11';
        else if (/Mac OS X/i.test(userAgent)) os = 'macOS';
        return {
            type: deviceType, browser, os, model,
            ip: (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '').toString(),
            userAgent
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

    // 记录查询函数
    function queryRecords(userId, { start, end, poopType } = {}) {
        const startKey = start ? (start instanceof Date
            ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
            : toDateKey(start)) : null;
        const endKey = end ? (end instanceof Date
            ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
            : toDateKey(end)) : null;

        const conds = ['user_id = ?'];
        const params = [userId];
        if (startKey) { conds.push("date(date, 'localtime') >= ?"); params.push(startKey); }
        if (endKey) { conds.push("date(date, 'localtime') < ?"); params.push(endKey); }
        if (poopType) { conds.push('poop_type = ?'); params.push(poopType); }

        const sql = `SELECT * FROM records WHERE ${conds.join(' AND ')} ORDER BY COALESCE(created_at, date) DESC, date DESC`;
        return db.prepare(sql).all(...params).map(mapRecord);
    }

    function computeStats(records) {
        const total = records.length;
        const typeCounts = {};
        let totalDuration = 0;
        let durationCount = 0;
        records.forEach(r => {
            const t = r.poopType || 0;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
            if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
        });
        const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;
        return { total, typeCounts, avgDuration };
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

    function parseFilterQuery(query) {
        const filter = {};
        if (query.start) {
            const s = parseDateKey(query.start);
            if (s) filter.start = s;
        }
        if (query.end) {
            const e = parseDateKey(query.end);
            if (e) { e.setHours(23, 59, 59, 999); filter.end = e; }
        }
        if (query.poop_type) {
            const pt = parseInt(query.poop_type, 10);
            if (!isNaN(pt) && pt >= 1 && pt <= 7) filter.poopType = pt;
        }
        return filter;
    }

    // API 路由
    app.get('/api/poop-types', (req, res) => res.json({ types: POOP_TYPES }));

    app.get('/api/home', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const records = queryRecords(userId).slice(0, 5);
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 6);
        weekAgo.setHours(0, 0, 0, 0);
        const last7 = queryRecords(userId, { start: weekAgo });
        const poopTypeStats = {};
        last7.forEach(r => {
            const key = String(r.poopType || 0);
            poopTypeStats[key] = (poopTypeStats[key] || 0) + 1;
        });
        res.json({
            streak: calculateStreak(userId),
            records,
            last7: { count: last7.length, poopTypeStats }
        });
    });

    app.get('/api/history', authenticateToken, (req, res) => {
        res.json({ records: queryRecords(req.user.userId) });
    });

    app.post('/api/record', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const device = extractDeviceInfo(req);
        const rawPoopType = req.body.poop_type;
        if (rawPoopType === undefined || rawPoopType === null || rawPoopType === '') {
            return res.status(400).json({ error: '请先选择大便类型' });
        }
        const poopType = parseInt(rawPoopType, 10);
        if (isNaN(poopType) || poopType < 1 || poopType > 7) {
            return res.status(400).json({ error: '请选择有效的大便类型（1-7型）' });
        }
        const duration = req.body.duration ? parseInt(req.body.duration, 10) : 0;
        const validDuration = (!isNaN(duration) && duration >= 0 && duration < 24 * 60 * 60) ? duration : 0;
        const notes = escapeHtml((req.body.notes || '').toString().slice(0, 500));
        const status = escapeHtml((req.body.status || '').toString().slice(0, 50));
        let recordDate = new Date();
        if (req.body.date) {
            const parsed = parseDateKey(req.body.date);
            if (!parsed) return res.status(400).json({ error: '日期格式无效' });
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            if (parsed.getTime() > endOfToday.getTime()) {
                return res.status(400).json({ error: '日期不能晚于今天' });
            }
            recordDate = parsed;
        }
        try {
            const result = db.prepare(`
                INSERT INTO records (user_id, date, notes, poop_type, duration, status,
                    device_type, device_browser, device_os, device_model, device_ip, device_user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, recordDate.toISOString(), notes, poopType, validDuration, status,
                device.type, device.browser, device.os, device.model, device.ip, device.userAgent);
            const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
            res.json({ success: true, record: mapRecord(record) });
        } catch (err) {
            res.status(500).json({ error: '记录失败' });
        }
    });

    app.put('/api/record/:id', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const id = parseInt(req.params.id);
        try {
            const existing = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, userId);
            if (!existing) return res.status(404).json({ error: '记录不存在' });
            let poopType = existing.poop_type;
            if (req.body.poop_type !== undefined && req.body.poop_type !== null) {
                const pt = parseInt(req.body.poop_type, 10);
                if (!isNaN(pt) && pt >= 1 && pt <= 7) poopType = pt;
                else return res.status(400).json({ error: '无效的大便类型' });
            }
            let duration = existing.duration || 0;
            if (req.body.duration !== undefined) {
                const d = parseInt(req.body.duration, 10);
                if (!isNaN(d) && d >= 0 && d < 24 * 60 * 60) duration = d;
                else return res.status(400).json({ error: '无效的持续时长' });
            }
            const notes = req.body.notes !== undefined ? escapeHtml(req.body.notes.toString().slice(0, 500)) : existing.notes;
            const status = req.body.status !== undefined ? escapeHtml(req.body.status.toString().slice(0, 50)) : existing.status;
            let recordDate = existing.date;
            if (req.body.date) {
                const parsed = parseDateKey(req.body.date);
                if (parsed) recordDate = parsed.toISOString();
            }
            db.prepare('UPDATE records SET date=?, notes=?, poop_type=?, duration=?, status=? WHERE id=? AND user_id=?').run(recordDate, notes, poopType, duration, status, id, userId);
            const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
            res.json({ success: true, record: mapRecord(updated) });
        } catch (err) {
            res.status(500).json({ error: '更新失败' });
        }
    });

    app.delete('/api/record/:id', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const id = parseInt(req.params.id);
        try {
            const record = db.prepare('SELECT user_id FROM records WHERE id = ?').get(id);
            if (!record) return res.status(404).json({ error: '记录不存在' });
            if (record.user_id !== userId) return res.status(403).json({ error: '无权限删除此记录' });
            db.prepare('DELETE FROM records WHERE id = ?').run(id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: '删除失败' });
        }
    });

    // 周视图（核心复杂逻辑）
    app.get('/api/weekly', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const base = parseDateKey(req.query.date) || new Date();
        const { start, end } = getWeekRange(base);
        const filter = parseFilterQuery(req.query);

        const records = queryRecords(userId, {
            start: filter.start || start,
            end: filter.end || end,
            poopType: filter.poopType
        });

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

    // 月视图（核心复杂逻辑）
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
        const filter = parseFilterQuery(req.query);

        const records = queryRecords(userId, {
            start: filter.start || start,
            end: filter.end || end,
            poopType: filter.poopType
        });

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

        // 周分组（复杂聚合逻辑）
        const weekBuckets = [];
        let currentWeekStart = new Date(start);
        while (currentWeekStart < end) {
            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(currentWeekStart.getDate() + 7);
            const realEnd = weekEnd < end ? weekEnd : end;
            let count = 0, totalDur = 0;
            const wkTypeStats = {};
            dailyList.forEach(d => {
                const dayDate = new Date(d.date);
                if (dayDate >= currentWeekStart && dayDate < realEnd) {
                    count += d.count;
                    totalDur += d.count * d.avgDuration;
                    Object.keys(d.typeCounts).forEach(t => {
                        wkTypeStats[t] = (wkTypeStats[t] || 0) + d.typeCounts[t];
                    });
                }
            });
            weekBuckets.push({
                start: currentWeekStart.toISOString(),
                end: realEnd.toISOString(),
                label: `${currentWeekStart.getMonth() + 1}/${String(currentWeekStart.getDate()).padStart(2, '0')} - ${realEnd.getMonth() + 1}/${String(realEnd.getDate()).padStart(2, '0')}`,
                count,
                avgDuration: count ? Math.round(totalDur / count) : 0,
                typeStats: wkTypeStats
            });
            currentWeekStart = weekEnd;
        }

        // 月度趋势对比
        const prevStart = new Date(base.getFullYear(), base.getMonth() - 1, 1);
        const prevEnd = new Date(base.getFullYear(), base.getMonth(), 1);
        const prevRecords = queryRecords(userId, { start: prevStart, end: prevEnd, poopType: filter.poopType });

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
            weeks: weekBuckets,
            summary: {
                totalCount: currentCount,
                avgDuration: currentCount ? Math.round(totalDuration / currentCount) : 0,
                avgPerDay: Math.round((currentCount / daysInMonth) * 10) / 10,
                typeStats
            },
            compareWithLastMonth: {
                count: prevRecords.length,
                diff: prevRecords.length ? Math.round((currentCount - prevRecords.length) / prevRecords.length * 100) : 0
            },
            records
        });
    });

    // 筛选列表
    app.get('/api/list', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const filter = parseFilterQuery(req.query);
        const records = queryRecords(userId, filter);
        const stats = computeStats(records);
        res.json({
            records, stats, filter: {
                start: filter.start ? filter.start.toISOString() : null,
                end: filter.end ? filter.end.toISOString() : null,
                poopType: filter.poopType || null
            }
        });
    });

    // 导出功能（CSV/TXT）
    app.get('/api/export', authenticateToken, (req, res) => {
        const userId = req.user.userId;
        const format = (req.query.format || 'csv').toString().toLowerCase();
        const range = req.query.range || 'month';

        const now = new Date();
        let start, end, fileName;
        if (range === 'week') {
            const wr = getWeekRange(now);
            start = wr.start; end = wr.end;
            fileName = `weekly_${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}${String(start.getDate()).padStart(2, '0')}`;
        } else if (range === 'all') {
            start = null; end = null; fileName = 'all_records';
        } else {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            fileName = `monthly_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        const filter = parseFilterQuery(req.query);
        const records = queryRecords(userId, {
            start: filter.start || start,
            end: filter.end || end,
            poopType: filter.poopType
        });

        if (format === 'txt') {
            const lines = [`拉屎记录导出 - ${new Date().toLocaleString('zh-CN')}`, `共 ${records.length} 条记录`, ''];
            records.forEach((r, i) => {
                const d = new Date(r.date);
                lines.push(`${i + 1}. ${d.toLocaleString('zh-CN')}`);
                const type = POOP_TYPES.find(t => t.id === r.poopType);
                lines.push(`   类型: ${type ? `${type.emoji} ${type.name} - ${type.description}` : '未记录'}`);
                lines.push(`   时长: ${r.duration ? formatDurationSec(r.duration) : '未记录'}`);
                if (r.status) lines.push(`   状态: ${r.status}`);
                if (r.notes) lines.push(`   备注: ${r.notes}`);
                lines.push('');
            });
            const stats = computeStats(records);
            lines.push('===== 统计 =====', `总次数: ${stats.total}`, `平均时长: ${formatDurationSec(stats.avgDuration)}`);
            POOP_TYPES.forEach(t => {
                const c = stats.typeCounts[t.id] || 0;
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
            const type = POOP_TYPES.find(t => t.id === r.poopType);
            rows.push([
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
                r.poopType || '',
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
});

afterAll(() => {
    db.close();
});

// ============ 周视图测试（核心复杂逻辑） ============
describe('周视图 - 数据聚合与计算', () => {
    beforeEach(() => {
        // 创建本周多天的记录
        const now = new Date();
        const weekRange = app.locals.getWeekRange(now);
        
        // 周一、周二、周三各创建记录
        for (let i = 0; i < 3; i++) {
            const d = new Date(weekRange.start);
            d.setDate(weekRange.start.getDate() + i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300 + i * 60, `周${i + 1}记录`, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回本周范围', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
        expect(res.body.range.start).toBeDefined();
        expect(res.body.range.end).toBeDefined();
    });

    test('应返回正确的周标签', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.weekLabel).toBeDefined();
        expect(res.body.weekLabel).toContain('年');
        expect(res.body.weekLabel).toContain('月');
        expect(res.body.weekLabel).toContain('日');
    });

    test('应返回每日数据', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.days).toBeDefined();
        expect(res.body.days.length).toBe(7);
    });

    test('应正确计算每日平均时长', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        // 找到周一的数据
        const weekRange = app.locals.getWeekRange(new Date());
        const mondayKey = `${weekRange.start.getFullYear()}-${String(weekRange.start.getMonth() + 1).padStart(2, '0')}-${String(weekRange.start.getDate()).padStart(2, '0')}`;
        const mondayData = res.body.days.find(d => d.date === mondayKey);
        
        expect(mondayData).toBeDefined();
        expect(mondayData.count).toBe(1);
        expect(mondayData.avgDuration).toBe(300);
    });

    test('应正确聚合总次数', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(3);
    });

    test('应正确计算平均每日次数', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.avgPerDay).toBeCloseTo(3 / 7, 1);
    });

    test('应正确聚合类型统计', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.typeStats['4']).toBe(3);
    });

    test('指定日期应返回对应周数据', async () => {
        // 创建一个特定日期的周
        const specificDate = '2024-01-15'; // 周一
        const res = await request(app).get(`/api/weekly?date=${specificDate}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range.start).toContain('2024-01-15');
        expect(res.body.range.end).toContain('2024-01-22');
    });

    test('无记录的日期应返回 count 为 0', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        const noRecordDays = res.body.days.filter(d => d.count === 0);
        expect(noRecordDays.length).toBe(4); // 除了周一二三，还有4天无记录
    });

    test('应包含原始记录列表', async () => {
        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBe(3);
    });
});

// ============ 周视图筛选测试 ============
describe('周视图 - 筛选功能', () => {
    beforeEach(() => {
        const now = new Date();
        const weekRange = app.locals.getWeekRange(now);
        
        // 创建不同类型的记录
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, new Date(weekRange.start).toISOString(), 4, 300, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, new Date(weekRange.start).toISOString(), 3, 240, new Date().toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('按类型筛选应正确', async () => {
        const res = await request(app).get('/api/weekly?poop_type=4')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(1);
        expect(res.body.records.every(r => r.poopType === 4)).toBe(true);
    });

    test('按日期范围筛选应正确', async () => {
        const weekRange = app.locals.getWeekRange(new Date());
        const start = weekRange.start.toISOString().split('T')[0];
        const end = new Date(weekRange.start);
        end.setDate(weekRange.start.getDate() + 1);
        const endStr = end.toISOString().split('T')[0];

        const res = await request(app).get(`/api/weekly?start=${start}&end=${endStr}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(2);
    });
});

// ============ 月视图测试（核心复杂逻辑） ============
describe('月视图 - 数据聚合与计算', () => {
    beforeEach(() => {
        // 创建本月多天的记录
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // 第1、5、10、15、20天各创建记录
        const days = [1, 5, 10, 15, 20];
        days.forEach((day, i) => {
            const d = new Date(start);
            d.setDate(day);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300 + i * 30, `第${day}天记录`, d.toISOString()
            );
        });
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回本月范围', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
        expect(res.body.range.start).toBeDefined();
        expect(res.body.range.end).toBeDefined();
    });

    test('应返回正确的月份标签', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBeDefined();
        expect(res.body.month).toMatch(/^\d{4}-\d{2}$/);
    });

    test('应返回每日数据', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.days).toBeDefined();
        
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        expect(res.body.days.length).toBe(daysInMonth);
    });

    test('应正确计算每日平均时长', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        // 找到第1天的数据
        const now = new Date();
        const firstDayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const firstDayData = res.body.days.find(d => d.date === firstDayKey);
        
        expect(firstDayData).toBeDefined();
        expect(firstDayData.count).toBe(1);
        expect(firstDayData.avgDuration).toBe(300);
    });

    test('应正确聚合总次数', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(5);
    });

    test('应正确计算平均每日次数', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        expect(res.body.summary.avgPerDay).toBeCloseTo(5 / daysInMonth, 1);
    });

    test('应正确聚合类型统计', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.typeStats['4']).toBe(5);
    });

    test('指定月份应返回对应月数据', async () => {
        const res = await request(app).get('/api/monthly?date=2024-01')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBe('2024-01');
        expect(res.body.range.start).toContain('2024-01-01');
        expect(res.body.range.end).toContain('2024-02-01');
    });

    test('无记录的日期应返回 count 为 0', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        const noRecordDays = res.body.days.filter(d => d.count === 0);
        expect(noRecordDays.length).toBeGreaterThan(0);
    });

    test('应包含原始记录列表', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBe(5);
    });
});

// ============ 月视图周分组测试（核心复杂聚合） ============
describe('月视图 - 周分组聚合', () => {
    beforeEach(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // 创建分布在不同周的记录
        for (let i = 0; i < 28; i += 7) {
            const d = new Date(start);
            d.setDate(i + 1);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300, new Date().toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回周分组数据', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.weeks).toBeDefined();
        expect(res.body.weeks.length).toBeGreaterThan(0);
    });

    test('每个周分组应有正确的标签', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        res.body.weeks.forEach(w => {
            expect(w.label).toBeDefined();
            expect(w.label).toContain('/');
        });
    });

    test('每个周分组应有正确的统计数据', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        res.body.weeks.forEach(w => {
            expect(w.count).toBeDefined();
            expect(w.avgDuration).toBeDefined();
            expect(w.typeStats).toBeDefined();
        });
    });

    test('周分组应正确聚合跨周记录', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        // 第一周至少有1条记录
        const firstWeek = res.body.weeks[0];
        expect(firstWeek.count).toBeGreaterThanOrEqual(1);
    });
});

// ============ 月视图趋势对比测试 ============
describe('月视图 - 趋势对比', () => {
    beforeEach(() => {
        const now = new Date();
        
        // 本月记录
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date(thisMonthStart).toISOString(), 4, new Date().toISOString()
        );
        
        // 上月记录
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date(lastMonthStart).toISOString(), 4, new Date().toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回上月对比数据', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.compareWithLastMonth).toBeDefined();
        expect(res.body.compareWithLastMonth.count).toBeDefined();
        expect(res.body.compareWithLastMonth.diff).toBeDefined();
    });

    test('应正确计算增长率', async () => {
        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        // 本月1条，上月1条，增长应为 0%
        expect(res.body.compareWithLastMonth.diff).toBe(0);
    });

    test('上月无记录时应正确处理', async () => {
        // 删除上月记录
        db.prepare('DELETE FROM records').run();
        
        // 只保留本月记录
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date(thisMonthStart).toISOString(), 4, new Date().toISOString()
        );

        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.compareWithLastMonth.count).toBe(0);
        expect(res.body.compareWithLastMonth.diff).toBe(0); // 无对比数据
    });
});

// ============ 导出功能测试 ============
describe('导出功能 - CSV 格式', () => {
    beforeEach(() => {
        const now = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            testUserId, now.toISOString(), 4, 300, '测试备注', '正常', now.toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回正确的 Content-Type', async () => {
        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-type']).toContain('utf-8');
    });

    test('应包含 UTF-8 BOM', async () => {
        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text.startsWith('\uFEFF')).toBe(true);
    });

    test('应包含正确的表头', async () => {
        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('日期');
        expect(res.text).toContain('时间');
        expect(res.text).toContain('类型编号');
        expect(res.text).toContain('类型名称');
        expect(res.text).toContain('描述');
        expect(res.text).toContain('持续时长(秒)');
        expect(res.text).toContain('状态');
        expect(res.text).toContain('备注');
    });

    test('应包含正确的记录数据', async () => {
        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('4'); // 类型编号
        expect(res.text).toContain('300'); // 持续时长
        expect(res.text).toContain('测试备注');
        expect(res.text).toContain('正常');
    });

    test('应正确处理特殊字符（CSV 转义）', async () => {
        // 创建包含特殊字符的记录
        db.prepare('UPDATE records SET notes = ? WHERE user_id = ?').run('包含"引号"的备注', testUserId);

        const res = await request(app).get('/api/export?format=csv')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('包含""引号""的备注'); // CSV 转义规则：引号双写
    });

    test('按周导出应正确', async () => {
        const res = await request(app).get('/api/export?format=csv&range=week')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('weekly_');
    });

    test('导出所有记录应正确', async () => {
        const res = await request(app).get('/api/export?format=csv&range=all')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('all_records');
    });

    test('按类型筛选导出应正确', async () => {
        const res = await request(app).get('/api/export?format=csv&poop_type=4')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('4');
    });
});

// ============ 导出功能测试 - TXT 格式 ============
describe('导出功能 - TXT 格式', () => {
    beforeEach(() => {
        const now = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            testUserId, now.toISOString(), 4, 300, '测试备注', '正常', now.toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回正确的 Content-Type', async () => {
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.headers['content-type']).toContain('utf-8');
    });

    test('应包含 UTF-8 BOM', async () => {
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text.startsWith('\uFEFF')).toBe(true);
    });

    test('应包含标题和统计信息', async () => {
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('拉屎记录导出');
        expect(res.text).toContain('共 1 条记录');
        expect(res.text).toContain('===== 统计 =====');
        expect(res.text).toContain('总次数: 1');
        expect(res.text).toContain('平均时长');
    });

    test('应包含正确的记录详情', async () => {
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('1.');
        expect(res.text).toContain('类型:');
        expect(res.text).toContain('🍌'); // 第4型的 emoji
        expect(res.text).toContain('第4型');
        expect(res.text).toContain('时长: 5 分');
        expect(res.text).toContain('状态: 正常');
        expect(res.text).toContain('备注: 测试备注');
    });

    test('应包含类型分布统计', async () => {
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('🍌 第4型: 1 次');
    });

    test('无时长记录应显示"未记录"', async () => {
        db.prepare('UPDATE records SET duration = 0 WHERE user_id = ?').run(testUserId);
        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('时长: 未记录');
    });

    test('按周导出 TXT 应正确', async () => {
        const res = await request(app).get('/api/export?format=txt&range=week')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('.txt');
    });

    test('导出所有 TXT 应正确', async () => {
        const res = await request(app).get('/api/export?format=txt&range=all')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('all_records.txt');
    });
});

// ============ 篮选列表测试 ============
describe('筛选列表 - 数据查询与统计', () => {
    beforeEach(() => {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, now.toISOString(), 4, 300, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 3, 240, new Date().toISOString()
        );
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回筛选后的记录', async () => {
        const res = await request(app).get('/api/list')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBe(2);
    });

    test('应返回统计数据', async () => {
        const res = await request(app).get('/api/list')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.stats).toBeDefined();
        expect(res.body.stats.total).toBe(2);
        expect(res.body.stats.avgDuration).toBe(270);
        expect(res.body.stats.typeCounts['4']).toBe(1);
        expect(res.body.stats.typeCounts['3']).toBe(1);
    });

    test('应返回筛选条件信息', async () => {
        const res = await request(app).get('/api/list')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.filter).toBeDefined();
    });

    test('按日期范围筛选应正确', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await request(app).get(`/api/list?start=${today}&end=${today}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
    });

    test('按类型筛选应正确', async () => {
        const res = await request(app).get('/api/list?poop_type=4')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].poopType).toBe(4);
    });

    test('多条件组合筛选应正确', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await request(app).get(`/api/list?start=${today}&poop_type=4`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
    });
});

// ============ 首页数据测试 ============
describe('首页数据 - 连续打卡与统计', () => {
    beforeEach(() => {
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 6);
        weekAgo.setHours(0, 0, 0, 0);
        
        // 创建连续7天的记录
        for (let i = 0; i < 7; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300 + i * 10, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回连续打卡天数', async () => {
        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.streak).toBeDefined();
        expect(res.body.streak).toBeGreaterThanOrEqual(1);
    });

    test('应返回最近5条记录', async () => {
        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBeLessThanOrEqual(5);
    });

    test('应返回最近7天的统计', async () => {
        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.last7).toBeDefined();
        expect(res.body.last7.count).toBe(7);
        expect(res.body.last7.poopTypeStats).toBeDefined();
    });

    test('最近7天统计应正确聚合类型', async () => {
        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.last7.poopTypeStats['4']).toBe(7);
    });
});

// ============ 历史记录测试 ============
describe('历史记录 - 查询与排序', () => {
    beforeEach(() => {
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4 - i, d.toISOString()
            );
        }
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应返回所有记录', async () => {
        const res = await request(app).get('/api/history')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBe(3);
    });

    test('应按创建时间降序排序', async () => {
        const res = await request(app).get('/api/history')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        
        // 检查排序：最新记录的 poopType 应为 4（今天）
        expect(res.body.records[0].poopType).toBe(4);
    });
});

// ============ 权限校验测试 ============
describe('记录路由 - 权限校验', () => {
    test('无认证应返回 401', async () => {
        const res = await request(app).get('/api/home');
        expect(res.status).toBe(401);
    });

    test('无效 token 应返回 403', async () => {
        const res = await request(app).get('/api/home')
            .set('Authorization', 'Bearer invalidtoken');
        expect(res.status).toBe(403);
    });

    test('其他用户无法访问本人记录', async () => {
        // 创建另一个用户
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(
            'otheruser', 'other@test.com', bcrypt.hashSync('pass', 10)
        ).lastInsertRowid;
        const otherToken = jwt.sign({ userId: otherUserId, username: 'otheruser', role: 'user' }, 'test-secret-key', { expiresIn: '30d' });

        // 创建 testUserId 的记录
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );

        // 其他用户尝试删除
        const res = await request(app).delete('/api/record/1')
            .set('Authorization', `Bearer ${otherToken}`);
        expect(res.status).toBe(403);

        // 清理
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });
});