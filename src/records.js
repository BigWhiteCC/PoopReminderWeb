'use strict';

const { getDb } = require('./database');
const { toDateKey, getWeekRange, getWeekNumber, mapRecord } = require('./utils');

// -------- 记录查询 --------
function queryRecords(userId, { start, end, poopType } = {}) {
    const db = getDb();

    const startKey = start ? (start instanceof Date
        ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
        : toDateKey(start)) : null;
    const endKey = end ? (end instanceof Date
        ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
        : toDateKey(end)) : null;

    const conds = ['r.user_id = ?'];
    const params = [userId];
    if (startKey) { conds.push("date(r.date, 'localtime') >= ?"); params.push(startKey); }
    if (endKey) { conds.push("date(r.date, 'localtime') < ?"); params.push(endKey); }
    if (poopType) { conds.push('r.poop_type = ?'); params.push(poopType); }

    const sql = `SELECT r.* FROM records r WHERE ${conds.join(' AND ')} ORDER BY COALESCE(r.created_at, r.date) DESC, r.date DESC`;
    return db.prepare(sql).all(...params).map(mapRecord);
}

// -------- 连续打卡天数 --------
function calculateStreak(userId) {
    const db = getDb();
    const records = db.prepare("SELECT date FROM records WHERE user_id = ? ORDER BY date DESC").all(userId);
    if (records.length === 0) return 0;

    const days = new Set(records.map(r => toDateKey(r.date)).filter(Boolean));
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (days.has(key)) streak++;
        else break;
    }
    return streak;
}

// -------- 统计计算 --------
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

    // 按日期聚合
    const byDay = {};
    records.forEach(r => {
        const key = toDateKey(r.date);
        if (!key) return;
        if (!byDay[key]) byDay[key] = { count: 0, totalDuration: 0, durationN: 0 };
        byDay[key].count++;
        if (r.duration && r.duration > 0) {
            byDay[key].totalDuration += r.duration;
            byDay[key].durationN++;
        }
    });
    const daily = Object.keys(byDay).sort().map(k => ({
        date: k,
        count: byDay[k].count,
        avgDuration: byDay[k].durationN ? Math.round(byDay[k].totalDuration / byDay[k].durationN) : 0
    }));

    // 按周聚合
    const byWeek = {};
    records.forEach(r => {
        const wr = getWeekRange(r.date);
        if (!wr) return;
        const key = `${wr.start.getFullYear()}-W${getWeekNumber(wr.start)}`;
        if (!byWeek[key]) byWeek[key] = { key, start: wr.start.toISOString(), count: 0, totalDuration: 0, durationN: 0 };
        byWeek[key].count++;
        if (r.duration && r.duration > 0) {
            byWeek[key].totalDuration += r.duration;
            byWeek[key].durationN++;
        }
    });
    const weekly = Object.values(byWeek).map(w => ({
        key: w.key, start: w.start, count: w.count,
        avgDuration: w.durationN ? Math.round(w.totalDuration / w.durationN) : 0
    })).sort((a, b) => a.key.localeCompare(b.key));

    return { total, typeCounts, avgDuration, daily, weekly };
}

// -------- 统一筛选解析 --------
function parseFilterQuery(query) {
    const { parseDateKey } = require('./utils');
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

module.exports = {
    queryRecords,
    calculateStreak,
    computeStats,
    parseFilterQuery
};
