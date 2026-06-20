'use strict';

// -------- 日期工具 --------

function toDateKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();

    const pure = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (pure) return `${pure[1]}-${pure[2]}-${pure[3]}`;

    const withTime = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (withTime) {
        const [, y, mo, d, h, mi, se, ms, tz] = withTime;
        if (!tz) return `${y}-${mo}-${d}`;
        const dt = new Date(Date.UTC(
            parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
            parseInt(h, 10), parseInt(mi, 10),
            se ? parseInt(se, 10) : 0,
            ms ? parseInt(String(ms).slice(0, 3).padEnd(3, '0'), 10) : 0
        ));
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

// -------- 设备信息提取 --------
function extractDeviceInfo(req) {
    const userAgent = req.headers['user-agent'] || '';
    let deviceType = '未知设备';
    let browser = '未知浏览器';
    let os = '未知系统';
    let model = '';

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
        const brandMatch =
            userAgent.match(/Pixel\s*\d*[a-z]*/i) ||
            userAgent.match(/SM-[A-Z0-9]+/i) ||
            userAgent.match(/Mi\s+\d+[a-z]*/i) ||
            userAgent.match(/Redmi\s*\w*/i) ||
            userAgent.match(/Huawei\s*\w*/i) ||
            userAgent.match(/Nexus\s+\d*/i) ||
            userAgent.match(/OnePlus\s*\d*[a-z]*/i);
        if (brandMatch) model = brandMatch[0];
    } else if (/Macintosh/i.test(userAgent)) model = 'Mac';
    else if (/Windows/i.test(userAgent)) model = 'Windows PC';

    return {
        type: deviceType, browser, os, model,
        ip: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString(),
        userAgent
    };
}

// -------- 记录映射 --------
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

module.exports = {
    toDateKey,
    parseDateKey,
    getWeekRange,
    daysBetween,
    getWeekNumber,
    extractDeviceInfo,
    mapRecord
};
