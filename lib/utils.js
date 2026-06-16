'use strict';

// -------- 布里斯托大便类型常量 --------
const POOP_TYPES = [
    { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球（很难排出）', category: '便秘' },
    { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状', category: '轻微便秘' },
    { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状', category: '正常' },
    { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状', category: '理想' },
    { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状', category: '缺乏纤维' },
    { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状，不成形', category: '轻度腹泻' },
    { id: 7, name: '第7型', emoji: '💧', description: '水状，无固体成分', category: '腹泻' }
];

// -------- 工具函数 --------
function extractDeviceInfo(req) {
    const userAgent = (req && req.headers && req.headers['user-agent']) || '';
    let deviceType = '未知设备';
    let browser = '未知浏览器';
    let os = '未知系统';
    let model = '';
    let ip = '';

    if (/Tablet|iPad/i.test(userAgent)) deviceType = '平板';
    else if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) deviceType = '移动设备';
    else deviceType = '桌面电脑';

    if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) browser = 'Chrome';
    else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari';
    else if (/Firefox/i.test(userAgent)) browser = 'Firefox';
    else if (/Edg/i.test(userAgent)) browser = 'Edge';
    else if (/MSIE|Trident/i.test(userAgent)) browser = 'IE';

    if (/Android/i.test(userAgent)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(userAgent)) os = 'iOS';
    else if (/Windows NT 10/i.test(userAgent)) os = 'Windows 10/11';
    else if (/Windows/i.test(userAgent)) os = 'Windows';
    else if (/Mac OS X/i.test(userAgent)) os = 'macOS';
    else if (/Linux/i.test(userAgent)) os = 'Linux';

    if (/iPhone/i.test(userAgent)) model = 'iPhone';
    else if (/iPad/i.test(userAgent)) model = 'iPad';
    else if (/iPod/i.test(userAgent)) model = 'iPod';
    else if (/Android/i.test(userAgent)) {
        const brandMatch = userAgent.match(/Pixel\s*\d*[a-z]*/i)
            || userAgent.match(/SM-[A-Z0-9]+/i)
            || userAgent.match(/Mi\s+\d+[a-z]*/i)
            || userAgent.match(/Redmi\s+\w*/i)
            || userAgent.match(/Huawei\s*\w*/i)
            || userAgent.match(/Nexus\s+\d*/i)
            || userAgent.match(/OnePlus\s*\d*[a-z]*/i);
        if (brandMatch) model = brandMatch[0];
    } else if (/Macintosh/i.test(userAgent)) model = 'Mac';
    else if (/Windows/i.test(userAgent)) model = 'Windows PC';

    if (req) {
        const forwarded = req.headers && req.headers['x-forwarded-for'];
        const remote = req.connection && req.connection.remoteAddress;
        ip = (forwarded || remote || req.ip || '').toString();
    }

    return {
        type: deviceType, browser, os, model, ip, userAgent
    };
}

function mapRecord(r) {
    if (!r) return null;
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

// 将任意日期字符串转换为 YYYY-MM-DD key。
// 关键：按"服务器本地时区"取日期，避免 UTC/本地 导致 00:00-08:00 的记录被归到"前一天"。
function toDateKey(dateStr) {
    if (dateStr === undefined || dateStr === null || dateStr === '') return null;
    const s = String(dateStr).trim();
    if (!s) return null;

    const pure = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (pure) return `${pure[1]}-${pure[2]}-${pure[3]}`;

    const withTime = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (withTime) {
        const [, y, mo, d, h, mi, se, ms, tz] = withTime;
        // 无时区偏移 → 视为本地时刻，直接取本地日期
        if (!tz) return `${y}-${mo}-${d}`;
        // 有时区偏移 → 解析为 Date，再取本地日期
        const dt = new Date(Date.UTC(
            parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
            parseInt(h, 10), parseInt(mi, 10),
            se ? parseInt(se, 10) : 0,
            ms ? parseInt(String(ms).slice(0, 3).padEnd(3, '0'), 10) : 0
        ));
        if (isNaN(dt.getTime())) return `${y}-${mo}-${d}`; // 兜底
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    // 退化方案：用 Date 解析（Node 对 ISO 字符串行为已标准化）
    const d = new Date(s);
    if (isNaN(d.getTime())) {
        const fallback = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return fallback ? `${fallback[1]}-${fallback[2]}-${fallback[3]}` : null;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 解析日期/时刻：支持 YYYY-MM-DD、YYYY-MM-DDTHH:mm、YYYY-MM-DDTHH:mm:ss、
// 以及带时区的完整 ISO 字符串。返回本地 Date 对象（无时区信息时按本地时间解析）。
function parseDateKey(dateStr) {
    if (dateStr === undefined || dateStr === null || dateStr === '') return null;
    const s = String(dateStr).trim();
    if (!s) return null;

    // YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:mm]
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
        // 带时区 → 用 UTC 构造再转回本地 Date
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
    // 纯日期 YYYY-MM-DD → 解析为本地 00:00:00
    const dOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dOnly) {
        const dt = new Date(parseInt(dOnly[1], 10), parseInt(dOnly[2], 10) - 1, parseInt(dOnly[3], 10));
        return isNaN(dt.getTime()) ? null : dt;
    }
    // 退一步：交给浏览器原生解析
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
}

// 获取周范围：返回周一和下周一 Date（本地时区 00:00），并附 YYYY-MM-DD keys
function getWeekRange(date) {
    const d = date instanceof Date ? new Date(date) : parseDateKey(date);
    if (!d || isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=周日
    const diff = day === 0 ? -6 : 1 - day; // 找到周一
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    return { start: monday, end: nextMonday };
}

// 生成 周起止 key 列表（按天）
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

// ISO 周数
function getWeekNumber(d) {
    if (!d || isNaN(d.getTime())) return null;
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

// 计算连续打卡天数
function calculateStreak(recordDates) {
    if (!Array.isArray(recordDates) || recordDates.length === 0) return 0;
    const days = new Set(recordDates.map(toDateKey).filter(Boolean));
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

// 计算一组记录的统计信息
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

    // 按日期聚合（次数、平均时长）
    const byDay = {};
    records.forEach(r => {
        const key = toDateKey(r.date);
        if (!key) return;
        if (!byDay[key]) byDay[key] = { count: 0, totalDuration: 0, durationN: 0, records: [] };
        byDay[key].count++;
        if (r.duration && r.duration > 0) {
            byDay[key].totalDuration += r.duration;
            byDay[key].durationN++;
        }
        byDay[key].records.push(r);
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

// 把秒数格式化成「X分Y秒」
function formatDurationSec(seconds) {
    const n = Number(seconds);
    if (!n || n <= 0) return '0 秒';
    const s = Math.floor(n);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
}

// 统一的筛选处理
function parseFilterQuery(query) {
    const filter = {};
    if (!query) return filter;
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
    POOP_TYPES,
    extractDeviceInfo,
    mapRecord,
    toDateKey,
    parseDateKey,
    getWeekRange,
    daysBetween,
    getWeekNumber,
    calculateStreak,
    computeStats,
    formatDurationSec,
    parseFilterQuery
};
