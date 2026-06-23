'use strict';

const { toDateKey, parseDateKey, getWeekRange, daysBetween, getWeekNumber, extractDeviceInfo, mapRecord } = require('./utils');

describe('utils.js - 日期工具函数', () => {
    describe('getWeekRange - 获取周范围', () => {
        test('周一应返回本周一到下周一', () => {
            const monday = new Date(2024, 0, 15); // 2024-01-15 周一
            const range = getWeekRange(monday);
            expect(range).not.toBeNull();
            expect(range.start.getDate()).toBe(15);
            expect(range.end.getDate()).toBe(22);
        });

        test('周日应返回上周一到本周一', () => {
            const sunday = new Date(2024, 0, 14); // 2024-01-14 周日
            const range = getWeekRange(sunday);
            expect(range).not.toBeNull();
            expect(range.start.getDate()).toBe(8);
            expect(range.end.getDate()).toBe(15);
        });

        test('日期字符串应正确解析', () => {
            const range = getWeekRange('2024-01-15');
            expect(range).not.toBeNull();
            expect(range.start.getFullYear()).toBe(2024);
        });

        test('无效日期应返回 null', () => {
            expect(getWeekRange('invalid')).toBeNull();
            expect(getWeekRange(null)).toBeNull();
            expect(getWeekRange(undefined)).toBeNull();
        });
    });

    describe('daysBetween - 获取日期范围内的所有天数', () => {
        test('正常范围应返回正确天数', () => {
            const start = new Date(2024, 0, 1);
            const end = new Date(2024, 0, 5);
            const days = daysBetween(start, end);
            expect(days.length).toBe(4);
            expect(days[0].getDate()).toBe(1);
            expect(days[3].getDate()).toBe(4);
        });

        test('相同日期应返回空数组', () => {
            const start = new Date(2024, 0, 1);
            const end = new Date(2024, 0, 1);
            const days = daysBetween(start, end);
            expect(days.length).toBe(0);
        });

        test('start > end 应返回空数组', () => {
            const start = new Date(2024, 0, 5);
            const end = new Date(2024, 0, 1);
            const days = daysBetween(start, end);
            expect(days.length).toBe(0);
        });
    });

    describe('getWeekNumber - 获取周数', () => {
        test('年初应返回正确周数', () => {
            const d = new Date(2024, 0, 1); // 2024-01-01
            const week = getWeekNumber(d);
            expect(week).toBeGreaterThan(0);
            expect(week).toBeLessThanOrEqual(52);
        });

        test('年末应返回正确周数', () => {
            const d = new Date(2024, 11, 31); // 2024-12-31
            const week = getWeekNumber(d);
            expect(week).toBeGreaterThan(0);
            expect(week).toBeLessThanOrEqual(52);
        });

        test('同一周内的日期应返回相同周数', () => {
            const monday = new Date(2024, 0, 15);
            const friday = new Date(2024, 0, 19);
            expect(getWeekNumber(monday)).toBe(getWeekNumber(friday));
        });
    });
});

describe('utils.js - 设备信息提取', () => {
    describe('extractDeviceInfo - 解析 User-Agent', () => {
        test('桌面 Chrome 应正确识别', () => {
            const req = {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                ip: '192.168.1.1',
                connection: { remoteAddress: '' }
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
                ip: '10.0.0.1',
                connection: { remoteAddress: '' }
            };
            const info = extractDeviceInfo(req);
            expect(info.type).toBe('移动设备');
            expect(info.browser).toBe('Safari');
            expect(info.os).toBe('iOS');
            expect(info.model).toBe('iPhone');
        });

        test('Android 手机 Chrome 应正确识别', () => {
            const req = {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
                },
                ip: '192.168.0.100',
                connection: { remoteAddress: '' }
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
                connection: { remoteAddress: '' }
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
                connection: { remoteAddress: '' }
            };
            const info = extractDeviceInfo(req);
            expect(info.browser).toBe('Edge');
        });

        test('Firefox 浏览器应正确识别', () => {
            const req = {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
                },
                connection: { remoteAddress: '' }
            };
            const info = extractDeviceInfo(req);
            expect(info.browser).toBe('Firefox');
        });

        test('macOS 桌面应正确识别', () => {
            const req = {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                connection: { remoteAddress: '' }
            };
            const info = extractDeviceInfo(req);
            expect(info.os).toBe('macOS');
            expect(info.model).toBe('Mac');
        });

        test('Linux 桌面应正确识别', () => {
            const req = {
                headers: {
                    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                connection: { remoteAddress: '' }
            };
            const info = extractDeviceInfo(req);
            expect(info.os).toBe('Linux');
        });

        test('未知 User-Agent 应返回默认值', () => {
            const req = {
                headers: {},
                connection: { remoteAddress: '' }
            };
            const info = extractDeviceInfo(req);
            expect(info.browser).toBe('未知浏览器');
            expect(info.os).toBe('未知系统');
        });

        test('x-forwarded-for 应优先作为 IP', () => {
            const req = {
                headers: {
                    'user-agent': 'test',
                    'x-forwarded-for': '10.20.30.40'
                },
                ip: '192.168.1.1'
            };
            const info = extractDeviceInfo(req);
            expect(info.ip).toBe('10.20.30.40');
        });

        test('connection.remoteAddress 应作为 IP 回退', () => {
            const req = {
                headers: { 'user-agent': 'test' },
                connection: { remoteAddress: '10.0.0.1' },
                ip: '192.168.1.1'
            };
            const info = extractDeviceInfo(req);
            expect(info.ip).toBe('10.0.0.1');
        });
    });
});

describe('utils.js - 记录映射', () => {
    describe('mapRecord - 数据库记录到 API 格式', () => {
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
                device_ip: '10.0.0.1',
                device_user_agent: 'test agent'
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
            expect(mapped.device.ip).toBe('10.0.0.1');
            expect(mapped.device.userAgent).toBe('test agent');
        });

        test('缺失字段应返回默认值', () => {
            const record = {
                id: 1,
                user_id: 10,
                date: '2024-01-15',
                poop_type: 4
            };
            const mapped = mapRecord(record);
            expect(mapped.id).toBe(1);
            expect(mapped.userId).toBe(10);
            expect(mapped.duration).toBe(0);
            expect(mapped.notes).toBeUndefined();
            expect(mapped.status).toBeUndefined();
        });

        test('duration 为 null 应返回 0', () => {
            const record = {
                id: 1,
                user_id: 10,
                date: '2024-01-15',
                poop_type: 4,
                duration: null
            };
            const mapped = mapRecord(record);
            expect(mapped.duration).toBe(0);
        });
    });
});