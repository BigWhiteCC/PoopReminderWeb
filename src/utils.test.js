'use strict';

const { toDateKey, parseDateKey, getWeekRange, daysBetween, getWeekNumber, extractDeviceInfo, mapRecord } = require('./utils');

describe('getWeekRange - 周范围计算', () => {
    test('周一应返回本周范围', () => {
        const monday = new Date(2024, 0, 15); // 2024-01-15 周一
        const range = getWeekRange(monday);
        expect(range).not.toBeNull();
        expect(range.start.getDay()).toBe(1);
        expect(range.end.getDay()).toBe(1);
        expect(range.end.getDate()).toBe(range.start.getDate() + 7);
    });

    test('周日应返回上周范围（周日为一周最后一天）', () => {
        const sunday = new Date(2024, 0, 14); // 2024-01-14 周日
        const range = getWeekRange(sunday);
        expect(range).not.toBeNull();
        expect(range.start.getDay()).toBe(1);
        expect(range.start.getDate()).toBe(8); // 2024-01-08 周一
    });

    test('无效日期应返回 null', () => {
        expect(getWeekRange(null)).toBeNull();
        expect(getWeekRange('invalid')).toBeNull();
        expect(getWeekRange(undefined)).toBeNull();
    });

    test('跨年周应正确计算', () => {
        const dec30 = new Date(2023, 11, 30); // 2023-12-30 周六
        const range = getWeekRange(dec30);
        expect(range).not.toBeNull();
        expect(range.start.getFullYear()).toBe(2023);
        expect(range.end.getFullYear()).toBe(2024);
    });
});

describe('daysBetween - 日期数组生成', () => {
    test('相同日期应返回空数组', () => {
        const d = new Date(2024, 0, 15);
        expect(daysBetween(d, d)).toEqual([]);
    });

    test('间隔 3 天应返回 3 个日期', () => {
        const start = new Date(2024, 0, 15);
        const end = new Date(2024, 0, 18);
        const days = daysBetween(start, end);
        expect(days.length).toBe(3);
        expect(days[0].getDate()).toBe(15);
        expect(days[1].getDate()).toBe(16);
        expect(days[2].getDate()).toBe(17);
    });

    test('跨月应正确生成', () => {
        const start = new Date(2024, 0, 30);
        const end = new Date(2024, 1, 2);
        const days = daysBetween(start, end);
        expect(days.length).toBe(3);
        expect(days[0].getMonth()).toBe(0);
        expect(days[2].getMonth()).toBe(1);
    });
});

describe('getWeekNumber - 周编号计算', () => {
    test('1月1日应返回正确周数', () => {
        const d = new Date(2024, 0, 1);
        const weekNum = getWeekNumber(d);
        expect(weekNum).toBeGreaterThan(0);
        expect(weekNum).toBeLessThanOrEqual(53);
    });

    test('12月31日应返回正确周数', () => {
        const d = new Date(2024, 11, 31);
        const weekNum = getWeekNumber(d);
        expect(weekNum).toBeGreaterThan(0);
    });

    test('同一周的日期应返回相同周数', () => {
        const monday = new Date(2024, 0, 15);
        const friday = new Date(2024, 0, 19);
        expect(getWeekNumber(monday)).toBe(getWeekNumber(friday));
    });
});

describe('extractDeviceInfo - 设备信息提取', () => {
    test('桌面 Chrome 应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            connection: { remoteAddress: '192.168.1.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Windows 10/11');
        expect(info.model).toBe('Windows PC');
        expect(info.ip).toBe('192.168.1.1');
    });

    test('iPhone Safari 应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
            ip: '10.0.0.1',
            connection: {}
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('Android Chrome 应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36' },
            connection: { remoteAddress: '192.168.0.100' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Android');
        expect(info.model).toBe('SM-S918B');
    });

    test('iPad 应识别为平板', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' },
            connection: { remoteAddress: '192.168.1.50' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('平板');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPad');
    });

    test('Edge 浏览器应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
            connection: { remoteAddress: '192.168.1.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Edge');
    });

    test('空 User-Agent 应返回默认值', () => {
        const req = {
            headers: {},
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
    });

    test('x-forwarded-for 应优先获取真实 IP', () => {
        const req = {
            headers: { 'user-agent': 'test', 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
            connection: { remoteAddress: '192.168.1.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.ip).toBe('203.0.113.50, 70.41.3.18, 150.172.238.178');
    });
});

describe('mapRecord - 记录映射', () => {
    test('完整记录应正确映射', () => {
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
            device_ip: '192.168.1.1',
            device_user_agent: 'test-agent'
        };
        const mapped = mapRecord(raw);
        expect(mapped.id).toBe(1);
        expect(mapped.userId).toBe(10);
        expect(mapped.date).toBe('2024-01-15T08:30:00');
        expect(mapped.poopType).toBe(4);
        expect(mapped.duration).toBe(300);
        expect(mapped.device.type).toBe('桌面电脑');
        expect(mapped.device.browser).toBe('Chrome');
    });

    test('缺少字段应返回默认值', () => {
        const raw = {
            id: 2,
            user_id: 10,
            date: '2024-01-15'
        };
        const mapped = mapRecord(raw);
        expect(mapped.duration).toBe(0);
        expect(mapped.poopType).toBeUndefined();
        expect(mapped.device).toBeDefined();
    });
});