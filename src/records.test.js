'use strict';

const Database = require('better-sqlite3');

let db;

jest.mock('./database', () => ({
    getDb: jest.fn()
}));

beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            poop_type INTEGER,
            duration INTEGER DEFAULT 0,
            status TEXT,
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            device_ip TEXT,
            device_user_agent TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    require('./database').getDb.mockReturnValue(db);
});

afterAll(() => {
    db.close();
});

beforeEach(() => {
    db.exec('DELETE FROM records');
});

const { queryRecords, computeStats, parseFilterQuery } = require('./records');

describe('queryRecords - 记录查询', () => {
    test('无记录应返回空数组', () => {
        const records = queryRecords(1);
        expect(records).toEqual([]);
    });

    test('应查询指定用户的记录', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(2, '2024-01-15', 4, '2024-01-15T08:00:00');

        const records = queryRecords(1);
        expect(records.length).toBe(1);
        expect(records[0].userId).toBe(1);
    });

    test('应按日期范围筛选', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-10', 4, '2024-01-10T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-20', 4, '2024-01-20T08:00:00');

        const start = new Date(2024, 0, 12);
        const end = new Date(2024, 0, 18);
        const records = queryRecords(1, { start, end });
        expect(records.length).toBe(1);
        expect(records[0].date).toBe('2024-01-15');
    });

    test('应按大便类型筛选', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 7, '2024-01-15T08:00:00');

        const records = queryRecords(1, { poopType: 4 });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });

    test('组合筛选条件应生效', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-10', 4, '2024-01-10T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 7, '2024-01-15T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T08:00:00');

        const start = new Date(2024, 0, 14);
        const end = new Date(2024, 0, 16);
        const records = queryRecords(1, { start, end, poopType: 4 });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
        expect(records[0].date).toBe('2024-01-15');
    });

    test('记录应按创建时间降序排列', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T08:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(1, '2024-01-15', 4, '2024-01-15T09:00:00');

        const records = queryRecords(1);
        expect(records.length).toBe(3);
        expect(records[0].date).toBe('2024-01-15');
    });
});

describe('computeStats - 统计计算', () => {
    test('空记录应返回默认统计', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.avgDuration).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录应正确统计', () => {
        const records = [{
            date: '2024-01-15T08:00:00',
            poopType: 4,
            duration: 300
        }];
        const stats = computeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.daily.length).toBe(1);
        expect(stats.weekly.length).toBe(1);
    });

    test('多条记录应正确统计', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 1, duration: 600 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 120 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(Math.round((300 + 600 + 120) / 3));
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[1]).toBe(1);
        expect(stats.daily.length).toBe(2);
    });

    test('无时长记录应被忽略', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: null },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T16:00:00', poopType: 4, duration: 0 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(300);
    });

    test('按周聚合应正确计算', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-22T08:00:00', poopType: 4, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(2);
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    test('空查询应返回空对象', () => {
        const filter = parseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('应解析 start 参数', () => {
        const filter = parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getDate()).toBe(15);
    });

    test('应解析 end 参数并设置为当天结束时间', () => {
        const filter = parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
        expect(filter.end.getSeconds()).toBe(59);
    });

    test('应解析 poop_type 参数', () => {
        const filter = parseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效的 poop_type 应被忽略', () => {
        const filter = parseFilterQuery({ poop_type: '0' });
        expect(filter.poopType).toBeUndefined();
        const filter2 = parseFilterQuery({ poop_type: '8' });
        expect(filter2.poopType).toBeUndefined();
        const filter3 = parseFilterQuery({ poop_type: 'invalid' });
        expect(filter3.poopType).toBeUndefined();
    });

    test('无效的日期应被忽略', () => {
        const filter = parseFilterQuery({ start: 'invalid-date', end: 'invalid-date' });
        expect(filter.start).toBeUndefined();
        expect(filter.end).toBeUndefined();
    });

    test('组合参数应正确解析', () => {
        const filter = parseFilterQuery({
            start: '2024-01-01',
            end: '2024-01-31',
            poop_type: '4'
        });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.poopType).toBe(4);
    });
});