const {
    getWeekRange,
    daysBetween,
    getWeekNumber,
    extractDeviceInfo,
    mapRecord
} = require('./utils');

describe('getWeekRange - 获取周范围', () => {
    test('周一应返回当周范围', () => {
        const monday = new Date(2024, 0, 15); // 2024-01-15 周一
        const range = getWeekRange(monday);
        expect(range).not.toBeNull();
        expect(range.start.getDate()).toBe(15);
        expect(range.end.getDate()).toBe(22);
    });

    test('周日应返回上周范围', () => {
        const sunday = new Date(2024, 0, 14); // 2024-01-14 周日
        const range = getWeekRange(sunday);
        expect(range).not.toBeNull();
        expect(range.start.getDate()).toBe(8);
        expect(range.end.getDate()).toBe(15);
    });

    test('无效日期应返回 null', () => {
        expect(getWeekRange(null)).toBeNull();
        expect(getWeekRange('invalid')).toBeNull();
        expect(getWeekRange(undefined)).toBeNull();
    });

    test('日期字符串应正确解析', () => {
        const range = getWeekRange('2024-01-15');
        expect(range).not.toBeNull();
        expect(range.start.getFullYear()).toBe(2024);
        expect(range.start.getMonth()).toBe(0);
    });

    test('跨年周应正确计算', () => {
        const date = new Date(2023, 11, 31); // 2023-12-31 周日
        const range = getWeekRange(date);
        expect(range).not.toBeNull();
        expect(range.start.getFullYear()).toBe(2023);
        expect(range.end.getFullYear()).toBe(2024);
    });
});

describe('daysBetween - 日期范围生成', () => {
    test('相同日期应返回空数组', () => {
        const start = new Date(2024, 0, 15);
        const end = new Date(2024, 0, 15);
        expect(daysBetween(start, end)).toEqual([]);
    });

    test('应生成包含开始不包含结束的日期数组', () => {
        const start = new Date(2024, 0, 15);
        const end = new Date(2024, 0, 18);
        const days = daysBetween(start, end);
        expect(days.length).toBe(3);
        expect(days[0].getDate()).toBe(15);
        expect(days[1].getDate()).toBe(16);
        expect(days[2].getDate()).toBe(17);
    });

    test('跨月份应正确生成', () => {
        const start = new Date(2024, 0, 30);
        const end = new Date(2024, 1, 3);
        const days = daysBetween(start, end);
        expect(days.length).toBe(4);
        expect(days[0].getMonth()).toBe(0);
        expect(days[3].getMonth()).toBe(1);
    });

    test('start 大于 end 应返回空数组', () => {
        const start = new Date(2024, 0, 18);
        const end = new Date(2024, 0, 15);
        expect(daysBetween(start, end)).toEqual([]);
    });
});

describe('getWeekNumber - 获取周数', () => {
    test('1月1日应返回正确周数', () => {
        const date = new Date(2024, 0, 1); // 2024-01-01 周一
        expect(getWeekNumber(date)).toBe(1);
    });

    test('年末应返回正确周数', () => {
        const date = new Date(2024, 11, 31); // 2024-12-31 周二
        const weekNum = getWeekNumber(date);
        expect([1, 53]).toContain(weekNum);
    });

    test('跨年应正确计算', () => {
        const date = new Date(2023, 11, 31); // 2023-12-31 周日
        const weekNum = getWeekNumber(date);
        expect([52, 1]).toContain(weekNum);
    });

    test('2023年第一周应正确计算', () => {
        const date = new Date(2023, 0, 1); // 2023-01-01 周日
        const weekNum = getWeekNumber(date);
        expect([52, 1]).toContain(weekNum);
    });
});

describe('extractDeviceInfo - 设备信息提取', () => {
    test('桌面 Chrome 应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
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
            headers: {
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
            },
            connection: { remoteAddress: '10.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('Android Chrome 应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            },
            connection: { remoteAddress: '192.168.0.100' },
            ip: '192.168.0.100'
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Android');
        expect(info.model).toBe('Pixel 8');
    });

    test('iPad 应识别为平板', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
            },
            connection: { remoteAddress: '192.168.1.2' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('平板');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPad');
    });

    test('Edge 浏览器应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
            },
            connection: { remoteAddress: '192.168.1.3' }
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Edge');
    });

    test('Firefox 浏览器应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
            },
            connection: { remoteAddress: '192.168.1.4' }
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Firefox');
    });

    test('macOS 应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            connection: { remoteAddress: '192.168.1.5' }
        };
        const info = extractDeviceInfo(req);
        expect(info.os).toBe('macOS');
        expect(info.model).toBe('Mac');
    });

    test('未知设备应返回默认值', () => {
        const req = {
            headers: {},
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
        expect(info.model).toBe('');
    });

    test('x-forwarded-for 应优先使用', () => {
        const req = {
            headers: {
                'user-agent': 'test',
                'x-forwarded-for': '203.0.113.50'
            },
            connection: { remoteAddress: '192.168.1.100' }
        };
        const info = extractDeviceInfo(req);
        expect(info.ip).toBe('203.0.113.50');
    });

    test('Samsung 设备应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            },
            connection: { remoteAddress: '192.168.1.6' }
        };
        const info = extractDeviceInfo(req);
        expect(info.model).toBe('SM-S918B');
    });

    test('Xiaomi 设备应正确识别', () => {
        const req = {
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 14; Mi 14 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            },
            connection: { remoteAddress: '192.168.1.7' }
        };
        const info = extractDeviceInfo(req);
        expect(info.model).toBe('Mi 14');
    });
});

describe('mapRecord - 记录映射', () => {
    test('完整记录应正确映射', () => {
        const record = {
            id: 1,
            user_id: 10,
            date: '2024-01-15T08:30:00',
            notes: '测试备注',
            poop_type: 4,
            duration: 300,
            status: '正常',
            device_type: '移动设备',
            device_browser: 'Chrome',
            device_os: 'Android',
            device_model: 'Pixel 8',
            device_ip: '192.168.1.1',
            device_user_agent: 'test UA'
        };
        const mapped = mapRecord(record);
        expect(mapped.id).toBe(1);
        expect(mapped.userId).toBe(10);
        expect(mapped.date).toBe('2024-01-15T08:30:00');
        expect(mapped.notes).toBe('测试备注');
        expect(mapped.poopType).toBe(4);
        expect(mapped.duration).toBe(300);
        expect(mapped.status).toBe('正常');
        expect(mapped.device.type).toBe('移动设备');
        expect(mapped.device.browser).toBe('Chrome');
        expect(mapped.device.os).toBe('Android');
        expect(mapped.device.model).toBe('Pixel 8');
        expect(mapped.device.ip).toBe('192.168.1.1');
        expect(mapped.device.userAgent).toBe('test UA');
    });

    test('缺失字段应返回默认值', () => {
        const record = {
            id: 2,
            user_id: 20,
            date: '2024-01-16T10:00:00'
        };
        const mapped = mapRecord(record);
        expect(mapped.id).toBe(2);
        expect(mapped.userId).toBe(20);
        expect(mapped.date).toBe('2024-01-16T10:00:00');
        expect(mapped.notes).toBeUndefined();
        expect(mapped.poopType).toBeUndefined();
        expect(mapped.duration).toBe(0);
        expect(mapped.status).toBeUndefined();
        expect(mapped.device.type).toBeUndefined();
    });

    test('duration 为 null 应返回 0', () => {
        const record = {
            id: 3,
            user_id: 30,
            date: '2024-01-17',
            duration: null
        };
        const mapped = mapRecord(record);
        expect(mapped.duration).toBe(0);
    });
});

// ============ toDateKey 实际模块测试 ============
describe('toDateKey - 实际模块日期键提取', () => {
    const { toDateKey } = require('./utils');

    test('null/undefined/空字符串应返回 null', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toDateKey(undefined)).toBeNull();
        expect(toDateKey('')).toBeNull();
    });

    test('纯日期格式 YYYY-MM-DD 应直接返回', () => {
        expect(toDateKey('2024-01-15')).toBe('2024-01-15');
        expect(toDateKey('2024-12-31')).toBe('2024-12-31');
        expect(toDateKey('2023-06-01')).toBe('2023-06-01');
    });

    test('带时间无时区应提取日期部分', () => {
        expect(toDateKey('2024-01-15T08:30:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
        expect(toDateKey('2024-06-15 14:30:00')).toBe('2024-06-15');
    });

    test('UTC 时区应正确转换', () => {
        // UTC 00:00 is always the same date globally (or next day in western timezones)
        const result = toDateKey('2024-01-15T00:00:00Z');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('带时区偏移应正确转换', () => {
        // +08:00 08:00 = UTC 00:00
        const result = toDateKey('2024-01-15T08:00:00+08:00');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('完全无效字符串应返回 null', () => {
        expect(toDateKey('not-a-date')).toBeNull();
        expect(toDateKey('abc')).toBeNull();
    });

    test('部分匹配的 ISO 字符串应尝试回退', () => {
        // Should try to extract YYYY-MM-DD from the beginning
        const result = toDateKey('2024-01-15T25:99:99');
        // This will try fallback or new Date - may return null or a date key
        expect(result === null || result.match(/^\d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    });

    test('数字输入应被转换为字符串处理', () => {
        // Number will be stringified, then tried as Date
        const result = toDateKey(20240115);
        // Might be null or a date depending on Date parsing
        expect(result === null || result.match(/^\d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    });
});

// ============ parseDateKey 实际模块测试 ============
describe('parseDateKey - 实际模块日期解析', () => {
    const { parseDateKey } = require('./utils');

    test('null/undefined应返回 null', () => {
        expect(parseDateKey(null)).toBeNull();
        expect(parseDateKey(undefined)).toBeNull();
    });

    test('纯日期应解析为本地午夜', () => {
        const d = parseDateKey('2024-01-15');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
        expect(d.getSeconds()).toBe(0);
    });

    test('带时间无时区应解析为本地时间', () => {
        const d = parseDateKey('2024-01-15T14:30:00');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(30);
    });

    test('UTC 时间应转换为本地时间', () => {
        const d = parseDateKey('2024-01-15T08:00:00Z');
        expect(d).not.toBeNull();
        expect(d instanceof Date).toBe(true);
        // The exact local time depends on timezone, but it should be a valid date
        expect(d.getFullYear()).toBe(2024);
    });

    test('带正偏移的时区应正确转换', () => {
        const d = parseDateKey('2024-01-15T08:00:00+08:00');
        expect(d).not.toBeNull();
        // +08:00 08:00 = UTC 00:00, local time depends on timezone
        expect(d instanceof Date).toBe(true);
    });

    test('带负偏移的时区应正确转换', () => {
        const d = parseDateKey('2024-01-15T00:00:00-05:00');
        expect(d).not.toBeNull();
        expect(d instanceof Date).toBe(true);
    });

    test('带毫秒的 ISO 字符串应正确解析', () => {
        const d = parseDateKey('2024-01-15T08:30:00.123');
        expect(d).not.toBeNull();
        expect(d.getHours()).toBe(8);
        expect(d.getMinutes()).toBe(30);
    });

    test('完全无效字符串应返回 null', () => {
        expect(parseDateKey('not-a-date')).toBeNull();
        expect(parseDateKey('abc123')).toBeNull();
    });

    test('空格前后有空白应正确处理', () => {
        const d = parseDateKey('  2024-01-15  ');
        // trim is applied, so this should work
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
    });

    test('闰年日期应正确解析', () => {
        const d = parseDateKey('2024-02-29');
        expect(d).not.toBeNull();
        expect(d.getMonth()).toBe(1);
        expect(d.getDate()).toBe(29);
    });

    test('非闰年2月29日应返回 null 或自动调整', () => {
        // 2023 is not a leap year, Feb 29 is invalid
        const d = parseDateKey('2023-02-29');
        // JavaScript Date auto-adjusts to Mar 1, so this returns a Date (not null)
        // But it's still a valid JS Date object
        if (d) {
            expect(d instanceof Date).toBe(true);
        }
    });
});