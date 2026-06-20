const { toDateKey, parseDateKey, getWeekRange, daysBetween, getWeekNumber, extractDeviceInfo, mapRecord } = require('./utils');

describe('toDateKey - 日期键生成', () => {
    test('纯日期格式应正确解析', () => {
        expect(toDateKey('2024-01-15')).toBe('2024-01-15');
        expect(toDateKey('2024-12-31')).toBe('2024-12-31');
    });

    test('带时间的 ISO 字符串应取日期部分', () => {
        expect(toDateKey('2024-01-15T08:30:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
    });

    test('带 Z 时区的 UTC 时间应转换为本地日期', () => {
        const result = toDateKey('2024-01-15T00:00:00Z');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('带时区偏移的 ISO 字符串应正确转换', () => {
        expect(toDateKey('2024-01-15T08:00:00+08:00')).toBe('2024-01-15');
    });

    test('空值和无效输入应返回 null', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toDateKey(undefined)).toBeNull();
        expect(toDateKey('')).toBeNull();
        expect(toDateKey('invalid')).toBeNull();
    });

    test('带空格的输入应被处理', () => {
        expect(toDateKey(' 2024-01-15 ')).toBe('2024-01-15');
    });
});

describe('parseDateKey - 日期解析', () => {
    test('纯日期应解析为本地时间', () => {
        const d = parseDateKey('2024-01-15');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('带时间的 ISO 字符串应正确解析', () => {
        const d = parseDateKey('2024-01-15T14:30:00');
        expect(d).not.toBeNull();
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(30);
    });

    test('无效输入应返回 null', () => {
        expect(parseDateKey(null)).toBeNull();
        expect(parseDateKey('invalid')).toBeNull();
    });
});

describe('getWeekRange - 获取周范围', () => {
    test('周一应返回当周范围', () => {
        const monday = new Date(2024, 0, 15); // 2024-01-15 是周一
        const range = getWeekRange(monday);
        expect(range).not.toBeNull();
        expect(range.start.getDate()).toBe(15);
        expect(range.end.getDate()).toBe(22);
    });

    test('周日应返回上周一到本周一', () => {
        const sunday = new Date(2024, 0, 14); // 2024-01-14 是周日
        const range = getWeekRange(sunday);
        expect(range).not.toBeNull();
        expect(range.start.getDate()).toBe(8);
        expect(range.end.getDate()).toBe(15);
    });

    test('无效日期应返回 null', () => {
        expect(getWeekRange('invalid')).toBeNull();
        expect(getWeekRange(null)).toBeNull();
    });

    test('字符串日期应正确解析', () => {
        const range = getWeekRange('2024-01-15');
        expect(range).not.toBeNull();
        expect(range.start.getFullYear()).toBe(2024);
    });
});

describe('daysBetween - 获取日期范围内所有天数', () => {
    test('同一日期应返回空数组', () => {
        const start = new Date(2024, 0, 15);
        const end = new Date(2024, 0, 15);
        expect(daysBetween(start, end)).toEqual([]);
    });

    test('跨 3 天应返回 2 天', () => {
        const start = new Date(2024, 0, 15);
        const end = new Date(2024, 0, 17);
        const result = daysBetween(start, end);
        expect(result.length).toBe(2);
        expect(result[0].getDate()).toBe(15);
        expect(result[1].getDate()).toBe(16);
    });

    test('跨周应正确计算', () => {
        const start = new Date(2024, 0, 14); // 周日
        const end = new Date(2024, 0, 21); // 周日
        const result = daysBetween(start, end);
        expect(result.length).toBe(7);
    });
});

describe('getWeekNumber - 获取周数', () => {
    test('年初日期应返回正确周数', () => {
        const d = new Date(2024, 0, 1); // 2024-01-01
        const week = getWeekNumber(d);
        expect(week).toBeGreaterThan(0);
        expect(week).toBeLessThanOrEqual(53);
    });

    test('年末日期应返回正确周数', () => {
        const d = new Date(2024, 11, 31); // 2024-12-31
        const week = getWeekNumber(d);
        expect(week).toBeGreaterThan(0);
        expect(week).toBeLessThanOrEqual(53);
    });

    test('同一周内日期应返回相同周数', () => {
        const monday = new Date(2024, 0, 15);
        const friday = new Date(2024, 0, 19);
        expect(getWeekNumber(monday)).toBe(getWeekNumber(friday));
    });
});

describe('extractDeviceInfo - 设备信息提取', () => {
    test('桌面 Chrome 应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Windows 10/11');
        expect(info.model).toBe('Windows PC');
    });

    test('移动设备应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
            },
            connection: { remoteAddress: '192.168.1.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('Android 设备应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            },
            connection: { remoteAddress: '10.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Android');
        expect(info.model).toContain('Pixel');
    });

    test('平板设备应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
            },
            ip: '127.0.0.1',
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('平板');
    });

    test('空 user-agent 应默认识别为桌面电脑', () => {
        const req = {
            headers: {},
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
    });

    test('x-forwarded-for 应优先使用', () => {
        const req = {
            headers: {
                'user-agent': 'test',
                'x-forwarded-for': '203.0.113.50'
            },
            connection: { remoteAddress: '192.168.1.1' },
            ip: '10.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.ip).toBe('203.0.113.50');
    });
});

describe('mapRecord - 记录映射', () => {
    test('完整记录应正确映射', () => {
        const raw = {
            id: 1,
            user_id: 10,
            date: '2024-01-15T08:30:00Z',
            notes: '测试备注',
            poop_type: 4,
            duration: 300,
            status: '正常',
            device_type: '移动设备',
            device_browser: 'Chrome',
            device_os: 'Android',
            device_model: 'Pixel',
            device_ip: '127.0.0.1',
            device_user_agent: 'test-agent'
        };
        const mapped = mapRecord(raw);
        expect(mapped.id).toBe(1);
        expect(mapped.userId).toBe(10);
        expect(mapped.poopType).toBe(4);
        expect(mapped.duration).toBe(300);
        expect(mapped.device.type).toBe('移动设备');
        expect(mapped.device.browser).toBe('Chrome');
    });

    test('缺失字段应返回默认值', () => {
        const raw = {
            id: 2,
            user_id: 20,
            date: '2024-01-15'
        };
        const mapped = mapRecord(raw);
        expect(mapped.duration).toBe(0);
        expect(mapped.poopType).toBeUndefined();
        expect(mapped.device).toBeDefined();
    });
});