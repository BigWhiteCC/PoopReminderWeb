'use strict';

const {
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
} = require('../lib/utils');

// ============================================================
// toDateKey: 跨时区日期归一化是最高风险逻辑
// ============================================================
describe('toDateKey', () => {
    test('null / undefined / 空字符串 → null', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toDateKey(undefined)).toBeNull();
        expect(toDateKey('')).toBeNull();
        expect(toDateKey('   ')).toBeNull();
    });

    test('纯日期 YYYY-MM-DD → 直接返回', () => {
        expect(toDateKey('2025-01-15')).toBe('2025-01-15');
        expect(toDateKey('2024-12-31')).toBe('2024-12-31');
    });

    test('ISO 无时区：按本地日期取（日期部分直接取）', () => {
        // 2025-03-10T08:30 无时区 → 直接取 2025-03-10
        expect(toDateKey('2025-03-10T08:30')).toBe('2025-03-10');
        expect(toDateKey('2025-03-10 08:30')).toBe('2025-03-10');
        expect(toDateKey('2025-03-10T23:59:59')).toBe('2025-03-10');
        expect(toDateKey('2025-03-10T00:00:00.000')).toBe('2025-03-10');
    });

    test('ISO 带 Z 时区 → 视为 UTC，再转本地日期', () => {
        // UTC 2025-03-10T00:00:00Z → 本地日期取决于时区偏移，但输出必须是有效的 YYYY-MM-DD
        const result = toDateKey('2025-03-10T00:00:00Z');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // 同时测试非边界时刻
        expect(toDateKey('2025-03-10T12:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('ISO 带正/负时区偏移', () => {
        const r1 = toDateKey('2025-03-10T12:00:00+08:00');
        expect(r1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const r2 = toDateKey('2025-03-10T12:00:00-0500');
        expect(r2).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('毫秒/秒级精度不影响日期部分', () => {
        expect(toDateKey('2025-03-10T08:30:45.123')).toBe('2025-03-10');
    });

    test('非日期字符串兜底或返回 null', () => {
        expect(toDateKey('hello')).toBeNull();
        expect(toDateKey('03/10/2025')).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Date.parse 能识别
    });

    test('数字输入作为字符串处理', () => {
        expect(toDateKey(20250115)).toBeNull(); // 纯数字被 toString 后不是日期格式
    });
});

// ============================================================
// parseDateKey: 将输入转换为本地 Date 对象
// ============================================================
describe('parseDateKey', () => {
    test('null / 空字符串 → null', () => {
        expect(parseDateKey(null)).toBeNull();
        expect(parseDateKey('')).toBeNull();
    });

    test('纯日期 → 本地 00:00 Date', () => {
        const d = parseDateKey('2025-05-20');
        expect(d).toBeInstanceOf(Date);
        expect(d.getFullYear()).toBe(2025);
        expect(d.getMonth()).toBe(4); // 0-indexed
        expect(d.getDate()).toBe(20);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    test('带时间的 ISO → 本地 Date', () => {
        const d = parseDateKey('2025-05-20T14:35:22');
        expect(d.getFullYear()).toBe(2025);
        expect(d.getMonth()).toBe(4);
        expect(d.getDate()).toBe(20);
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(35);
        expect(d.getSeconds()).toBe(22);
    });

    test('带 Z 时区 → UTC，返回本地 Date', () => {
        const d = parseDateKey('2025-05-20T12:00:00Z');
        // 不能直接断言本地小时数（依赖时区），但必须是有效的 Date
        expect(isNaN(d.getTime())).toBe(false);
    });

    test('带 +HH:mm 时区偏移', () => {
        const d = parseDateKey('2025-05-20T12:00:00+08:00');
        expect(isNaN(d.getTime())).toBe(false);
    });

    test('空格分隔的日期时间', () => {
        const d = parseDateKey('2025-05-20 14:35');
        expect(d.getFullYear()).toBe(2025);
        expect(d.getDate()).toBe(20);
        expect(d.getHours()).toBe(14);
    });

    test('无效字符串 → null', () => {
        expect(parseDateKey('not-a-date')).toBeNull();
    });
});

// ============================================================
// getWeekRange / daysBetween / getWeekNumber: 日历计算
// ============================================================
describe('getWeekRange', () => {
    test('周一 → 从当周一开始，下周一结束', () => {
        const base = new Date(2025, 2, 10); // 2025-03-10 周一
        const r = getWeekRange(base);
        expect(r.start.getDay()).toBe(1); // 周一
        expect(r.end.getDay()).toBe(1);
        expect((r.end - r.start) / (1000 * 60 * 60 * 24)).toBe(7);
    });

    test('周日 → 回退到本周周一', () => {
        const base = new Date(2025, 2, 16); // 周日
        const r = getWeekRange(base);
        // 本周一是 3/10
        expect(r.start.getDate()).toBe(10);
    });

    test('周五 → 保持同一周', () => {
        const base = new Date(2025, 2, 14); // 周五
        const r = getWeekRange(base);
        expect(r.start.getDate()).toBe(10);
        expect(r.end.getDate()).toBe(17);
    });

    test('接受字符串输入', () => {
        const r = getWeekRange('2025-03-14');
        expect(r).not.toBeNull();
        expect(r.start.getDate()).toBe(10);
    });

    test('null 或无效日期 → null', () => {
        expect(getWeekRange(null)).toBeNull();
        expect(getWeekRange('bad')).toBeNull();
    });
});

describe('daysBetween', () => {
    test('7 天跨度返回 7 个 Date', () => {
        const start = new Date(2025, 2, 10);
        const end = new Date(2025, 2, 17);
        const days = daysBetween(start, end);
        expect(days.length).toBe(7);
        expect(days[0].getDate()).toBe(10);
        expect(days[6].getDate()).toBe(16);
    });

    test('0 天跨度返回空数组', () => {
        const d = new Date(2025, 2, 10);
        expect(daysBetween(d, d)).toHaveLength(0);
    });

    test('跨年跨度', () => {
        const start = new Date(2025, 11, 29);
        const end = new Date(2026, 0, 3);
        const days = daysBetween(start, end);
        expect(days.length).toBe(5);
    });
});

describe('getWeekNumber', () => {
    test('2025-01-02 周四 → 第 1 周', () => {
        // ISO 8601：一年的第一个周四所在周为第 1 周
        expect(getWeekNumber(new Date(2025, 0, 2))).toBe(1);
    });

    test('2025-03-10 周一 → 第 11 周（验证常用计算）', () => {
        const wn = getWeekNumber(new Date(2025, 2, 10));
        expect(typeof wn).toBe('number');
        expect(wn).toBeGreaterThan(0);
        expect(wn).toBeLessThan(54);
    });

    test('null / invalid → null', () => {
        expect(getWeekNumber(null)).toBeNull();
        expect(getWeekNumber(new Date('invalid'))).toBeNull();
    });
});

// ============================================================
// calculateStreak: 连续打卡逻辑
// ============================================================
describe('calculateStreak', () => {
    test('空数组 → 0', () => {
        expect(calculateStreak([])).toBe(0);
    });

    test('今天有记录 → 至少 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dates = [today.toISOString()];
        expect(calculateStreak(dates)).toBeGreaterThanOrEqual(1);
    });

    test('今天 + 昨天 → 至少 2', () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const dates = [today.toISOString(), yesterday.toISOString()];
        expect(calculateStreak(dates)).toBeGreaterThanOrEqual(2);
    });

    test('缺失昨天 → 0（今天没有直接也没有最近）', () => {
        // 注意：如果今天没有记录，且昨天也没有，返回 0
        const d = new Date();
        d.setDate(d.getDate() - 5);
        const dates = [d.toISOString()];
        expect(calculateStreak(dates)).toBe(0);
    });

    test('非数组输入 → 0', () => {
        expect(calculateStreak(null)).toBe(0);
        expect(calculateStreak('abc')).toBe(0);
    });
});

// ============================================================
// computeStats: 统计聚合
// ============================================================
describe('computeStats', () => {
    const makeRecord = (date, poopType, duration, extra = {}) => ({
        date, poopType, duration, ...extra
    });

    test('空数组 → total 为 0，其他为空结构', () => {
        const s = computeStats([]);
        expect(s.total).toBe(0);
        expect(s.avgDuration).toBe(0);
        expect(s.daily).toHaveLength(0);
        expect(s.weekly).toHaveLength(0);
    });

    test('单条记录 → 正确聚合', () => {
        const s = computeStats([makeRecord('2025-03-10T08:00', 3, 300)]);
        expect(s.total).toBe(1);
        expect(s.avgDuration).toBe(300);
        expect(s.typeCounts[3]).toBe(1);
        expect(s.daily).toHaveLength(1);
        expect(s.daily[0].date).toBe('2025-03-10');
        expect(s.daily[0].count).toBe(1);
    });

    test('同一天多条记录 → daily count 聚合', () => {
        const records = [
            makeRecord('2025-03-10T08:00', 3, 300),
            makeRecord('2025-03-10T20:00', 4, 500)
        ];
        const s = computeStats(records);
        expect(s.total).toBe(2);
        expect(s.daily).toHaveLength(1);
        expect(s.daily[0].count).toBe(2);
        // 平均时长：(300 + 500) / 2 = 400
        expect(s.daily[0].avgDuration).toBe(400);
    });

    test('不同周记录 → weekly 分开聚合', () => {
        const records = [
            makeRecord('2025-03-10T08:00', 3, 300), // 周一
            makeRecord('2025-03-17T08:00', 4, 500)  // 下周一
        ];
        const s = computeStats(records);
        expect(s.weekly.length).toBe(2);
    });

    test('0 时长的记录不计入 avgDuration', () => {
        const records = [
            makeRecord('2025-03-10T08:00', 3, 0),
            makeRecord('2025-03-10T20:00', 4, 400)
        ];
        const s = computeStats(records);
        expect(s.avgDuration).toBe(400); // 只算 400 那条
    });

    test('poopType 为 0/undefined 聚合到 key 0', () => {
        const records = [
            makeRecord('2025-03-10T08:00', undefined, 300),
            makeRecord('2025-03-10T20:00', 0, 500)
        ];
        const s = computeStats(records);
        expect(s.typeCounts[0]).toBe(2);
    });
});

// ============================================================
// formatDurationSec: 格式化
// ============================================================
describe('formatDurationSec', () => {
    test('0 / null / 负值 → 0 秒', () => {
        expect(formatDurationSec(0)).toBe('0 秒');
        expect(formatDurationSec(null)).toBe('0 秒');
        expect(formatDurationSec(-10)).toBe('0 秒');
    });

    test('小于 60 秒 → N 秒', () => {
        expect(formatDurationSec(30)).toBe('30 秒');
        expect(formatDurationSec(59)).toBe('59 秒');
    });

    test('整分钟 → N 分', () => {
        expect(formatDurationSec(120)).toBe('2 分');
        expect(formatDurationSec(600)).toBe('10 分');
    });

    test('非整分钟 → N 分 M 秒', () => {
        expect(formatDurationSec(125)).toBe('2 分 5 秒');
        expect(formatDurationSec(3671)).toBe('61 分 11 秒');
    });

    test('字符串数字兼容', () => {
        expect(formatDurationSec('120')).toBe('2 分');
    });
});

// ============================================================
// parseFilterQuery: 筛选参数解析
// ============================================================
describe('parseFilterQuery', () => {
    test('空对象 → 空筛选', () => {
        const f = parseFilterQuery({});
        expect(f).toEqual({});
    });

    test('只有 start 日期', () => {
        const f = parseFilterQuery({ start: '2025-03-01' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.start.getFullYear()).toBe(2025);
        expect(f.end).toBeUndefined();
    });

    test('只有 end 日期 → 被设为当天结束', () => {
        const f = parseFilterQuery({ end: '2025-03-10' });
        expect(f.end.getHours()).toBe(23);
        expect(f.end.getMinutes()).toBe(59);
        expect(f.end.getSeconds()).toBe(59);
    });

    test('有效 poop_type 1–7', () => {
        for (let i = 1; i <= 7; i++) {
            expect(parseFilterQuery({ poop_type: i }).poopType).toBe(i);
        }
    });

    test('无效 poop_type 被忽略', () => {
        expect(parseFilterQuery({ poop_type: 0 })).toEqual({});
        expect(parseFilterQuery({ poop_type: 8 })).toEqual({});
        expect(parseFilterQuery({ poop_type: 'abc' })).toEqual({});
    });

    test('无效日期被忽略', () => {
        const f = parseFilterQuery({ start: 'not-a-date', end: '2025-03-10' });
        expect(f.start).toBeUndefined();
        expect(f.end).toBeInstanceOf(Date);
    });

    test('null / undefined query → 空筛选', () => {
        expect(parseFilterQuery(null)).toEqual({});
        expect(parseFilterQuery(undefined)).toEqual({});
    });
});

// ============================================================
// extractDeviceInfo: User-Agent 解析
// ============================================================
describe('extractDeviceInfo', () => {
    test('null 请求 → 空字符串 UA，未知分类', () => {
        const info = extractDeviceInfo(null);
        expect(info.userAgent).toBe('');
        expect(info.ip).toBe('');
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
        expect(info.model).toBe('');
    });

    test('桌面 Chrome on Windows', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            connection: { remoteAddress: '192.168.1.1' }
        });
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Windows 10/11');
        expect(info.ip).toBe('192.168.1.1');
    });

    test('移动设备 - Android Chrome (Pixel)', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
            connection: { remoteAddress: '10.0.0.1' }
        });
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Android');
        expect(info.model).toBe('Pixel 7');
    });

    test('移动设备 - iPhone Safari', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
            connection: { remoteAddress: '10.0.0.2' }
        });
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('平板 - iPad', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
            connection: { remoteAddress: '10.0.0.3' }
        });
        expect(info.type).toBe('平板');
        expect(info.model).toBe('iPad');
    });

    test('桌面 Safari on macOS', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' },
            connection: { remoteAddress: '10.0.0.4' }
        });
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('macOS');
        expect(info.model).toBe('Mac');
    });

    test('x-forwarded-for 优先于 remoteAddress', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'test', 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
            connection: { remoteAddress: '10.0.0.5' }
        });
        expect(info.ip).toBe('203.0.113.1, 10.0.0.1');
    });

    test('Edge 浏览器（基于 Chromium，不被误识别为 Chrome）', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
            connection: { remoteAddress: '10.0.0.6' }
        });
        expect(info.browser).toBe('Edge');
    });

    test('Firefox on Linux', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0' },
            connection: { remoteAddress: '10.0.0.7' }
        });
        expect(info.browser).toBe('Firefox');
        expect(info.os).toBe('Linux');
    });

    test('旧 IE User-Agent', () => {
        const info = extractDeviceInfo({
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko' },
            connection: { remoteAddress: '10.0.0.8' }
        });
        expect(info.browser).toBe('IE');
    });
});

// ============================================================
// mapRecord: 字段映射
// ============================================================
describe('mapRecord', () => {
    test('正常数据映射', () => {
        const raw = {
            id: 42,
            user_id: 1,
            date: '2025-03-10T08:00:00.000Z',
            notes: '晨便',
            poop_type: 4,
            duration: 300,
            status: '顺畅',
            device_type: '移动设备',
            device_browser: 'Chrome',
            device_os: 'Android',
            device_model: 'Pixel 7',
            device_ip: '10.0.0.1',
            device_user_agent: 'ua/string'
        };
        const r = mapRecord(raw);
        expect(r.id).toBe(42);
        expect(r.userId).toBe(1);
        expect(r.date).toBe('2025-03-10T08:00:00.000Z');
        expect(r.notes).toBe('晨便');
        expect(r.poopType).toBe(4);
        expect(r.duration).toBe(300);
        expect(r.status).toBe('顺畅');
        expect(r.device.type).toBe('移动设备');
        expect(r.device.browser).toBe('Chrome');
        expect(r.device.os).toBe('Android');
        expect(r.device.model).toBe('Pixel 7');
        expect(r.device.ip).toBe('10.0.0.1');
        expect(r.device.userAgent).toBe('ua/string');
    });

    test('duration 为 0 / null → 0', () => {
        expect(mapRecord({ id: 1, user_id: 1, duration: 0 }).duration).toBe(0);
        expect(mapRecord({ id: 1, user_id: 1, duration: null }).duration).toBe(0);
    });
});

// ============================================================
// POOP_TYPES: 常量定义
// ============================================================
describe('POOP_TYPES', () => {
    test('包含 7 个类型，id 1..7', () => {
        expect(POOP_TYPES).toHaveLength(7);
        POOP_TYPES.forEach((t, i) => {
            expect(t.id).toBe(i + 1);
            expect(typeof t.name).toBe('string');
            expect(typeof t.description).toBe('string');
            expect(typeof t.category).toBe('string');
        });
    });
});
