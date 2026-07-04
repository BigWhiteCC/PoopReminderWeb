process.env.JWT_SECRET = 'test-secret-key';

describe('queryRecords - 记录查询', () => {
    let mockDb;
    let mockPrepare;
    let mockAll;

    beforeEach(() => {
        jest.resetModules();
        
        mockAll = jest.fn().mockReturnValue([]);
        mockPrepare = jest.fn().mockReturnValue({ all: mockAll });
        mockDb = {
            pragma: jest.fn(),
            exec: jest.fn(),
            prepare: mockPrepare
        };

        jest.mock('better-sqlite3', () => jest.fn(() => mockDb));
    });

    test('无记录应返回空数组', () => {
        const { queryRecords } = require('./records');
        const records = queryRecords(1);
        expect(records).toEqual([]);
        expect(mockPrepare).toHaveBeenCalled();
    });

    test('应返回指定用户的所有记录', () => {
        mockAll.mockReturnValue([
            { id: 1, user_id: 1, date: '2024-01-15T08:30:00', notes: '', poop_type: 4, duration: 300, status: '正常', created_at: '2024-01-15T08:30:00' },
            { id: 2, user_id: 1, date: '2024-01-14T10:00:00', notes: '', poop_type: 3, duration: 240, status: '正常', created_at: '2024-01-14T10:00:00' }
        ]);
        const { queryRecords } = require('./records');
        const records = queryRecords(1);
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(3);
    });

    test('应支持日期范围筛选', () => {
        mockAll.mockReturnValue([
            { id: 1, user_id: 1, date: '2024-01-15T08:00:00', notes: '', poop_type: 3, duration: 300, status: '正常', created_at: '2024-01-15T08:00:00' }
        ]);
        const { queryRecords } = require('./records');
        const records = queryRecords(1, {
            start: new Date(2024, 0, 12),
            end: new Date(2024, 0, 18)
        });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(3);
    });

    test('应支持大便类型筛选', () => {
        mockAll.mockReturnValue([
            { id: 1, user_id: 1, date: '2024-01-15T08:00:00', notes: '', poop_type: 4, duration: 300, status: '正常', created_at: '2024-01-15T08:00:00' },
            { id: 2, user_id: 1, date: '2024-01-17T08:00:00', notes: '', poop_type: 4, duration: 240, status: '正常', created_at: '2024-01-17T08:00:00' }
        ]);
        const { queryRecords } = require('./records');
        const records = queryRecords(1, { poopType: 4 });
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(4);
    });
});

describe('calculateStreak - 连续打卡天数', () => {
    let mockDb;
    let mockPrepare;
    let mockAll;

    beforeEach(() => {
        jest.resetModules();
        
        mockAll = jest.fn().mockReturnValue([]);
        mockPrepare = jest.fn().mockReturnValue({ all: mockAll });
        mockDb = { 
            pragma: jest.fn(),
            exec: jest.fn(),
            prepare: mockPrepare 
        };

        jest.mock('better-sqlite3', () => jest.fn(() => mockDb));
    });

    test('无记录时应返回 0', () => {
        const { calculateStreak } = require('./records');
        expect(calculateStreak(1)).toBe(0);
    });

    test('今天有记录时应返回 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        mockAll.mockReturnValue([{ date: today.toISOString() }]);
        const { calculateStreak } = require('./records');
        expect(calculateStreak(1)).toBe(1);
    });

    test('连续 7 天打卡应返回 7', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const records = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            records.push({ date: d.toISOString() });
        }
        mockAll.mockReturnValue(records);
        const { calculateStreak } = require('./records');
        expect(calculateStreak(1)).toBe(7);
    });

    test('中断打卡应返回中断前的天数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        mockAll.mockReturnValue([
            { date: today.toISOString() },
            { date: yesterday.toISOString() }
        ]);
        const { calculateStreak } = require('./records');
        expect(calculateStreak(1)).toBe(2);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        mockAll.mockReturnValue([{ date: yesterday.toISOString() }]);
        const { calculateStreak } = require('./records');
        expect(calculateStreak(1)).toBe(0);
    });

    test('同一天多条记录应算作一天', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        mockAll.mockReturnValue([
            { date: today.toISOString() },
            { date: today.toISOString() }
        ]);
        const { calculateStreak } = require('./records');
        expect(calculateStreak(1)).toBe(1);
    });
});

describe('computeStats - 统计计算', () => {
    test('空记录应返回默认统计', () => {
        const { computeStats } = require('./records');
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.avgDuration).toBe(0);
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录应正确计算', () => {
        const { computeStats } = require('./records');
        const records = [
            { date: '2024-01-15T08:30:00', poopType: 4, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.daily.length).toBe(1);
        expect(stats.weekly.length).toBe(1);
    });

    test('多条记录应正确计算', () => {
        const { computeStats } = require('./records');
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: 120 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(4);
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.typeCounts[5]).toBe(1);
        expect(stats.avgDuration).toBe(Math.round((300 + 240 + 600 + 120) / 4));
        expect(stats.daily.length).toBe(3);
    });

    test('无 duration 的记录应被正确处理', () => {
        const { computeStats } = require('./records');
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: null },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 300 },
            { date: '2024-01-17T08:00:00', poopType: 4, duration: 0 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(300);
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    test('空查询应返回空对象', () => {
        const { parseFilterQuery } = require('./records');
        const filter = parseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('有效 start 应被解析', () => {
        const { parseFilterQuery } = require('./records');
        const filter = parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('无效 start 应被忽略', () => {
        const { parseFilterQuery } = require('./records');
        const filter = parseFilterQuery({ start: 'invalid' });
        expect(filter.start).toBeUndefined();
    });

    test('有效 end 应被解析并设置为当天最后时刻', () => {
        const { parseFilterQuery } = require('./records');
        const filter = parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
    });

    test('有效 poop_type 应被解析', () => {
        const { parseFilterQuery } = require('./records');
        const filter = parseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效 poop_type 应被忽略', () => {
        const { parseFilterQuery } = require('./records');
        
        const filter = parseFilterQuery({ poop_type: '0' });
        expect(filter.poopType).toBeUndefined();

        const filter2 = parseFilterQuery({ poop_type: '8' });
        expect(filter2.poopType).toBeUndefined();

        const filter3 = parseFilterQuery({ poop_type: 'invalid' });
        expect(filter3.poopType).toBeUndefined();
    });

    test('应支持组合筛选', () => {
        const { parseFilterQuery } = require('./records');
        const filter = parseFilterQuery({
            start: '2024-01-01',
            end: '2024-01-31',
            poop_type: '3'
        });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.poopType).toBe(3);
    });
});