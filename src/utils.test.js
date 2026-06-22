const { getWeekRange, daysBetween, getWeekNumber, extractDeviceInfo } = require('./utils');

describe('getWeekRange - 获取周范围', () => {
    test('应返回周一到下周一的范围', () => {
        const date = new Date(2024, 0, 15); // 2024-01-15 周一
        const range = getWeekRange(date);
        expect(range).not.toBeNull();
        expect(range.start.getDay()).toBe(1); // Monday
        expect(range.end.getDay()).toBe(1); // Next Monday
        expect(range.start.getDate()).toBe(15);
        expect(range.end.getDate()).toBe(22);
    });

    test('周日应返回上周周一到本周周一', () => {
        const date = new Date(2024, 0, 14); // 2024-01-14 周日
        const range = getWeekRange(date);
        expect(range).not.toBeNull();
        expect(range.start.getDay()).toBe(1); // Monday
        expect(range.start.getDate()).toBe(8); // 上周一
        expect(range.end.getDate()).toBe(15); // 本周一
    });

    test('无效日期应返回 null', () => {
        expect(getWeekRange(null)).toBeNull();
        expect(getWeekRange(undefined)).toBeNull();
        expect(getWeekRange('invalid')).toBeNull();
    });

    test('字符串日期应正确解析', () => {
        const range = getWeekRange('2024-01-15');
        expect(range).not.toBeNull();
        expect(range.start.getFullYear()).toBe(2024);
        expect(range.start.getMonth()).toBe(0);
        expect(range.start.getDate()).toBe(15);
    });
});

describe('daysBetween - 日期范围内的天数', () => {
    test('应返回两个日期之间的所有日期', () => {
        const start = new Date(2024, 0, 1);
        const end = new Date(2024, 0, 4);
        const days = daysBetween(start, end);
        expect(days.length).toBe(3);
        expect(days[0].getDate()).toBe(1);
        expect(days[1].getDate()).toBe(2);
        expect(days[2].getDate()).toBe(3);
    });

    test('同一天应返回空数组', () => {
        const start = new Date(2024, 0, 1);
        const end = new Date(2024, 0, 1);
        const days = daysBetween(start, end);
        expect(days.length).toBe(0);
    });

    test('跨月份应正确计算', () => {
        const start = new Date(2024, 0, 30);
        const end = new Date(2024, 1, 3);
        const days = daysBetween(start, end);
        expect(days.length).toBe(4);
        expect(days[0].getDate()).toBe(30);
        expect(days[1].getDate()).toBe(31);
        expect(days[2].getMonth()).toBe(1); // February
        expect(days[2].getDate()).toBe(1);
        expect(days[3].getDate()).toBe(2);
    });
});

describe('getWeekNumber - 获取周数', () => {
    test('1月1日应返回合理周数', () => {
        const d = new Date(2024, 0, 1);
        const week = getWeekNumber(d);
        expect(week).toBeGreaterThan(0);
        expect(week).toBeLessThanOrEqual(53);
    });

    test('12月31日应返回合理周数', () => {
        const d = new Date(2024, 11, 31);
        const week = getWeekNumber(d);
        expect(week).toBeGreaterThan(0);
        expect(week).toBeLessThanOrEqual(53);
    });

    test('同一周的日期应返回相同周数', () => {
        const monday = new Date(2024, 0, 15);
        const friday = new Date(2024, 0, 19);
        expect(getWeekNumber(monday)).toBe(getWeekNumber(friday));
    });

    test('跨周日期应返回不同周数', () => {
        const sunday = new Date(2024, 0, 14);
        const monday = new Date(2024, 0, 15);
        expect(getWeekNumber(sunday)).not.toBe(getWeekNumber(monday));
    });
});

describe('extractDeviceInfo - 设备信息提取', () => {
    test('空请求应返回默认值', () => {
        const req = { headers: {}, connection: {}, ip: '' };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
        expect(info.model).toBe('');
    });

    test('Chrome浏览器应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Windows 10/11');
        expect(info.type).toBe('桌面电脑');
        expect(info.model).toBe('Windows PC');
    });

    test('Safari浏览器应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('macOS');
        expect(info.type).toBe('桌面电脑');
        expect(info.model).toBe('Mac');
    });

    test('移动设备应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('Android设备应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.os).toBe('Android');
        expect(info.model).toBe('Pixel 8');
    });

    test('平板设备应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('平板');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPad');
    });

    test('IP应正确提取', () => {
        const req = {
            headers: { 'x-forwarded-for': '192.168.1.100', 'user-agent': '' },
            connection: { remoteAddress: '10.0.0.1' },
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.ip).toBe('192.168.1.100');
    });

    test('Edge浏览器应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Edge');
    });

    test('Firefox浏览器应正确识别', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0' },
            connection: {},
            ip: '127.0.0.1'
        };
        const info = extractDeviceInfo(req);
        expect(info.browser).toBe('Firefox');
    });
});