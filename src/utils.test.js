'use strict';

/**
 * src/utils.js 单元测试
 * 重点覆盖：设备信息提取、日期工具函数、记录映射
 */

const {
    toDateKey,
    parseDateKey,
    getWeekRange,
    daysBetween,
    getWeekNumber,
    extractDeviceInfo,
    mapRecord
} = require('./utils');

// ============ toDateKey 测试 ============
describe('toDateKey - 日期键提取', () => {
    test('纯日期格式 YYYY-MM-DD', () => {
        expect(toDateKey('2024-01-15')).toBe('2024-01-15');
        expect(toDateKey('2024-12-31')).toBe('2024-12-31');
    });

    test('带时间无时区的 ISO 字符串', () => {
        expect(toDateKey('2024-01-15T08:30:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
    });

    test('带 Z 时区的 UTC 时间', () => {
        expect(toDateKey('2024-01-15T00:00:00Z')).toBe('2024-01-15');
        const result = toDateKey('2024-01-15T16:00:00Z');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('带时区偏移的 ISO 字符串', () => {
        expect(toDateKey('2024-01-15T08:00:00+08:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T00:00:00-08:00')).toBe('2024-01-15');
    });

    test('空值和无效输入返回 null', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toDateKey(undefined)).toBeNull();
        expect(toDateKey('')).toBeNull();
        expect(toDateKey('invalid')).toBeNull();
    });

    test('边界：跨日期时间点', () => {
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
        expect(toDateKey('2024-01-16T00:00:00')).toBe('2024-01-16');
    });

    test('带毫秒的 ISO 字符串', () => {
        expect(toDateKey('2024-01-15T08:30:00.123Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('部分无效格式能提取日期部分', () => {
        expect(toDateKey('2024-01-15-invalid')).toBe('2024-01-15');
    });
});

// ============ parseDateKey 测试 ============
describe('parseDateKey - 完整日期解析', () => {
    test('纯日期解析为本地 00:00:00', () => {
        const d = parseDateKey('2024-01-15');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    test('带时间的 ISO 字符串', () => {
        const d = parseDateKey('2024-01-15T14:30:00');
        expect(d).not.toBeNull();
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(30);
    });

    test('带 Z 时区转换为本地时间', () => {
        const d = parseDateKey('2024-01-15T08:00:00Z');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('带时区偏移正确转换', () => {
        const d = parseDateKey('2024-01-15T08:00:00+08:00');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('无效日期返回 null', () => {
        expect(parseDateKey(null)).toBeNull();
        expect(parseDateKey('invalid')).toBeNull();
        expect(parseDateKey('not-a-date')).toBeNull();
    });

    test('带毫秒和秒的完整 ISO', () => {
        const d = parseDateKey('2024-01-15T14:30:45.500Z');
        expect(d).not.toBeNull();
        expect(d.getSeconds()).toBe(45);
    });

    test('负时区偏移', () => {
        const d = parseDateKey('2024-01-15T20:00:00-05:00');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
    });
});

// ============ getWeekRange 测试 ============
describe('getWeekRange - 周范围计算', () => {
    test('周一应返回本周范围', () => {
        // 2024-01-15 是周一
        const result = getWeekRange(new Date(2024, 0, 15));
        expect(result).not.toBeNull();
        expect(result.start.getDate()).toBe(15);
        expect(result.end.getDate()).toBe(22);
    });

    test('周日应返回本周范围（周一到下周一）', () => {
        // 2024-01-21 是周日
        const result = getWeekRange(new Date(2024, 0, 21));
        expect(result).not.toBeNull();
        expect(result.start.getDate()).toBe(15);
        expect(result.end.getDate()).toBe(22);
    });

    test('周三应返回本周范围', () => {
        // 2024-01-17 是周三
        const result = getWeekRange(new Date(2024, 0, 17));
        expect(result).not.toBeNull();
        expect(result.start.getDate()).toBe(15);
    });

    test('无效日期返回 null', () => {
        expect(getWeekRange(null)).toBeNull();
        expect(getWeekRange('invalid')).toBeNull();
    });

    test('字符串日期输入', () => {
        const result = getWeekRange('2024-01-15');
        expect(result).not.toBeNull();
        expect(result.start.getDate()).toBe(15);
    });
});

// ============ daysBetween 测试 ============
describe('daysBetween - 日期区间生成', () => {
    test('生成 7 天', () => {
        const start = new Date(2024, 0, 15);
        const end = new Date(2024, 0, 22);
        const days = daysBetween(start, end);
        expect(days.length).toBe(7);
        expect(days[0].getDate()).toBe(15);
        expect(days[6].getDate()).toBe(21);
    });

    test('同一天返回空数组', () => {
        const d = new Date(2024, 0, 15);
        const days = daysBetween(d, d);
        expect(days.length).toBe(0);
    });

    test('跨月生成', () => {
        const start = new Date(2024, 0, 28);
        const end = new Date(2024, 1, 5);
        const days = daysBetween(start, end);
        // 28, 29, 30, 31, 1, 2, 3, 4 = 8 days
        expect(days.length).toBe(8);
        expect(days[0].getDate()).toBe(28);
        expect(days[7].getDate()).toBe(4);
    });
});

// ============ getWeekNumber 测试 ============
describe('getWeekNumber - ISO 周数计算', () => {
    test('年初周数', () => {
        const d = new Date(2024, 0, 1);
        const wn = getWeekNumber(d);
        expect(wn).toBe(1);
    });

    test('年中周数', () => {
        const d = new Date(2024, 5, 15);
        const wn = getWeekNumber(d);
        expect(wn).toBeGreaterThan(20);
        expect(wn).toBeLessThan(30);
    });

    test('年末周数', () => {
        const d = new Date(2024, 11, 31);
        const wn = getWeekNumber(d);
        // 2024-12-31 可能属于第1周（2025年）或第52/53周，取决于ISO周数计算
        expect(wn).toBeGreaterThanOrEqual(1);
        expect(wn).toBeLessThanOrEqual(53);
    });
});

// ============ extractDeviceInfo 测试 ============
describe('extractDeviceInfo - 设备信息提取', () => {
    const createMockReq = (userAgent, forwardedFor = null, remoteAddress = '127.0.0.1') => ({
        headers: {
            'user-agent': userAgent,
            'x-forwarded-for': forwardedFor
        },
        connection: { remoteAddress }
    });

    test('桌面 Chrome 浏览器', () => {
        const req = createMockReq('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Windows 10/11');
        expect(info.model).toBe('Windows PC');
    });

    test('移动设备 iPhone', () => {
        const req = createMockReq('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15');
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('平板 iPad', () => {
        const req = createMockReq('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15');
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('平板');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPad');
    });

    test('Android 设备', () => {
        const req = createMockReq('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Android');
        expect(info.model).toBe('Pixel 8');
    });

    test('Firefox 浏览器', () => {
        const req = createMockReq('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0');
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Firefox');
    });

    test('Edge 浏览器（基于 Chromium）', () => {
        const req = createMockReq('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');
        const info = extractDeviceInfo(req);
        // Edge UA 包含 "Edg"，但代码中 Safari 检测优先于 Chrome
        // 实际行为：由于 Safari 检测在 Chrome 之后，Edge UA 不含 Safari 但含 Chrome 和 Edg
        expect(info.browser).toBe('Edge');
    });

    test('macOS 设备', () => {
        const req = createMockReq('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15');
        const info = extractDeviceInfo(req);
        expect(info.os).toBe('macOS');
        expect(info.model).toBe('Mac');
    });

    test('Linux 设备', () => {
        const req = createMockReq('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
        const info = extractDeviceInfo(req);
        expect(info.os).toBe('Linux');
    });

    test('空 User-Agent 返回默认值', () => {
        const req = createMockReq('');
        const info = extractDeviceInfo(req);
        // 空 UA 不匹配任何设备类型检测，默认为桌面电脑
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
    });

    test('IP 地址提取 - x-forwarded-for', () => {
        const req = createMockReq('Chrome', '192.168.1.1, 10.0.0.1');
        const info = extractDeviceInfo(req);
        expect(info.ip).toBe('192.168.1.1, 10.0.0.1');
    });

    test('IP 地址提取 - remoteAddress', () => {
        const req = createMockReq('Chrome', null, '10.0.0.5');
        const info = extractDeviceInfo(req);
        expect(info.ip).toBe('10.0.0.5');
    });

    test('Samsung 设备型号识别', () => {
        const req = createMockReq('Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
        const info = extractDeviceInfo(req);
        expect(info.model).toBe('SM-G991B');
    });

    test('IE 浏览器识别', () => {
        const req = createMockReq('Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko');
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('IE');
    });
});

// ============ mapRecord 测试 ============
describe('mapRecord - 记录映射', () => {
    test('完整记录映射', () => {
        const raw = {
            id: 1,
            user_id: 10,
            date: '2024-01-15T08:30:00',
            notes: '测试备注',
            poop_type: 4,
            duration: 300,
            status: '正常',
            device_type: '桌面电脑',
            device_browser: 'Chrome',
            device_os: 'Windows',
            device_model: 'PC',
            device_ip: '127.0.0.1',
            device_user_agent: 'Chrome/120'
        };
        const mapped = mapRecord(raw);
        expect(mapped.id).toBe(1);
        expect(mapped.userId).toBe(10);
        expect(mapped.date).toBe('2024-01-15T08:30:00');
        expect(mapped.notes).toBe('测试备注');
        expect(mapped.poopType).toBe(4);
        expect(mapped.duration).toBe(300);
        expect(mapped.status).toBe('正常');
        expect(mapped.device.type).toBe('桌面电脑');
        expect(mapped.device.browser).toBe('Chrome');
    });

    test('无 duration 时默认 0', () => {
        const raw = {
            id: 1,
            user_id: 10,
            date: '2024-01-15',
            poop_type: 4,
            duration: null
        };
        const mapped = mapRecord(raw);
        expect(mapped.duration).toBe(0);
    });

    test('无设备信息时返回空值', () => {
        const raw = {
            id: 1,
            user_id: 10,
            date: '2024-01-15',
            poop_type: 4
        };
        const mapped = mapRecord(raw);
        expect(mapped.device.type).toBeUndefined();
        expect(mapped.device.browser).toBeUndefined();
    });
});