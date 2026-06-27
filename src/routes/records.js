'use strict';

const express = require('express');
const { getDb } = require('../database');
const { POOP_TYPES } = require('../config');
const { authenticateToken, handleError, escapeHtml } = require('../middleware');
const { queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('../records');
const { toDateKey, parseDateKey, getWeekRange, daysBetween } = require('../utils');

const router = express.Router();

// -------- 首页 --------
router.get('/home', authenticateToken, (req, res) => {
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

// -------- 历史记录 --------
router.get('/history', authenticateToken, (req, res) => {
    res.json({ records: queryRecords(req.user.userId) });
});

// -------- 新增记录 --------
router.post('/', authenticateToken, (req, res) => {
    const db = getDb();
    const userId = req.user.userId;
    const { extractDeviceInfo } = require('../utils');
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
    } else {
        const now = new Date();
        if (recordDate.getTime() > now.getTime() + 1000) recordDate = now;
    }

    try {
        const result = db.prepare(`
            INSERT INTO records (
                user_id, date, notes, poop_type, duration, status,
                device_type, device_browser, device_os, device_model, device_ip, device_user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, recordDate.toISOString(), notes, poopType, validDuration, status,
            device.type, device.browser, device.os, device.model, device.ip, device.userAgent
        );
        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
        const { mapRecord } = require('../utils');
        res.json({ success: true, record: mapRecord(record) });
    } catch (err) {
        const e = handleError(err, 'createRecord');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 更新记录 --------
router.put('/:id', authenticateToken, (req, res) => {
    const db = getDb();
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

        db.prepare(`
            UPDATE records SET date=?, notes=?, poop_type=?, duration=?, status=?
            WHERE id=? AND user_id=?
        `).run(recordDate, notes, poopType, duration, status, id, userId);

        const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
        const { mapRecord } = require('../utils');
        res.json({ success: true, record: mapRecord(updated) });
    } catch (err) {
        const e = handleError(err, 'updateRecord');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 删除记录 --------
router.delete('/:id', authenticateToken, (req, res) => {
    const db = getDb();
    const userId = req.user.userId;
    const id = parseInt(req.params.id);

    try {
        const record = db.prepare('SELECT user_id FROM records WHERE id = ?').get(id);
        if (!record) return res.status(404).json({ error: '记录不存在' });
        if (record.user_id !== userId) return res.status(403).json({ error: '无权限删除此记录' });
        db.prepare('DELETE FROM records WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        const e = handleError(err, 'deleteRecord');
        res.status(e.status).json({ error: e.message });
    }
});

// -------- 周视图 --------
router.get('/weekly', authenticateToken, (req, res) => {
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

// -------- 月视图 --------
router.get('/monthly', authenticateToken, (req, res) => {
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

    // 周分组
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

    // 月度趋势
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

// -------- 筛选 --------
router.get('/list', authenticateToken, (req, res) => {
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

// -------- 导出 --------
router.get('/export', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const format = (req.query.format || 'csv').toString().toLowerCase();
    const range = req.query.range || 'month';

    const now = new Date();
    let start, end, fileName;
    if (range === 'week') {
        const wr = getWeekRange(now);
        if (!wr) {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1);
            end = new Date(start);
            end.setDate(start.getDate() + 7);
        } else {
            start = wr.start;
            end = wr.end;
        }
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

function formatDurationSec(seconds) {
    const n = Number(seconds);
    if (!n || n <= 0) return '0 秒';
    const s = Math.floor(n);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
}

module.exports = router;
