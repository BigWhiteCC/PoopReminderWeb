process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');

const TEST_DB_PATH = ':memory:';
let db;
let queryRecords, calculateStreak, computeStats, parseFilterQuery;

beforeAll(() => {
    jest.resetModules();

    db = new Database(TEST_DB_PATH);

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

    const databaseModule = require('./database');
    databaseModule.getDb = () => db;

    ({ queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('./records'));
});

afterAll(() => {
    db.close();
});

describe('parseFilterQuery - 筛选解析', () => {
    test('空查询应返回空对象', () => {
        expect(parseFilterQuery({})).toEqual({});
    });

    test('有效 start 日期应被解析', () => {
        const result = parseFilterQuery({ start: '2024-01-01' });
        expect(result.start).toBeInstanceOf(Date);
        expect(result.start.getFullYear()).toBe(2024);
        expect(result.start.getMonth()).toBe(0);
        expect(result.start.getDate()).toBe(1);
    });

    test('有效 end 日期应被解析并设置为当天结束', () => {
        const result = parseFilterQuery({ end: '2024-01-31' });
        expect(result.end).toBeInstanceOf(Date);
        expect(result.end.getHours()).toBe(23);
        expect(result.end.getMinutes()).toBe(59);
        expect(result.end.getSeconds()).toBe(59);
    });

    test('无效日期应被忽略', () => {
        const result = parseFilterQuery({ start: 'invalid', end: 'invalid' });
        expect(result.start).toBeUndefined();
        expect(result.end).toBeUndefined();
    });

    test('有效 poop_type 应被解析', () => {
        const result = parseFilterQuery({ poop_type: '4' });
        expect(result.poopType).toBe(4);
    });

    test('无效 poop_type 应被忽略', () => {
        expect(parseFilterQuery({ poop_type: '0' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: '8' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: 'abc' }).poopType).toBeUndefined();
    });

    test('完整筛选条件应正确解析', () => {
        const result = parseFilterQuery({
            start: '2024-01-01',
            end: '2024-01-31',
            poop_type: '4'
        });
        expect(result.start).toBeInstanceOf(Date);
        expect(result.end).toBeInstanceOf(Date);
        expect(result.poopType).toBe(4);
    });
});

describe('computeStats - 统计计算', () => {
    test('空记录应返回零值', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.avgDuration).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录应正确统计', () => {
        const records = [{
            date: '2024-01-15T08:30:00',
            poopType: 4,
            duration: 300
        }];
        const stats = computeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.typeCounts['4']).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.daily.length).toBe(1);
        expect(stats.daily[0].date).toBe('2024-01-15');
    });

    test('多条记录应正确统计', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 1, duration: 600 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 240 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.typeCounts['4']).toBe(2);
        expect(stats.typeCounts['1']).toBe(1);
        expect(stats.avgDuration).toBe(Math.round((300 + 600 + 240) / 3));
        expect(stats.daily.length).toBe(2);
    });

    test('无时长记录应被正确处理', () => {
        const records = [
            { date: '2024-01-15', poopType: 4, duration: null },
            { date: '2024-01-15', poopType: 1, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(2);
        expect(stats.avgDuration).toBe(300);
    });

    test('按周统计应正确分组', () => {
        const records = [
            { date: '2024-01-15', poopType: 4, duration: 300 },
            { date: '2024-01-16', poopType: 4, duration: 240 },
            { date: '2024-01-22', poopType: 1, duration: 180 }
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(2);
    });
});

describe('queryRecords - 记录查询', () => {
    const testUserId = 1;

    beforeEach(() => {
        db.prepare('DELETE FROM records').run();

        const now = new Date();
        for (let i = 0; i < 5; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)')
                .run(testUserId, d.toISOString(), (i % 7) + 1, 300 + i * 60);
        }
    });

    test('查询所有记录应返回全部', () => {
        const records = queryRecords(testUserId);
        expect(records.length).toBe(5);
    });

    test('按日期范围筛选应正确过滤', () => {
        const start = new Date();
        start.setDate(start.getDate() - 2);
        const end = new Date();
        end.setDate(end.getDate() + 1);

        const records = queryRecords(testUserId, { start, end });
        expect(records.length).toBe(3);
    });

    test('按类型筛选应正确过滤', () => {
        const records = queryRecords(testUserId, { poopType: 1 });
        expect(records.length).toBeGreaterThanOrEqual(1);
        records.forEach(r => expect(r.poopType).toBe(1));
    });

    test('组合筛选应正确工作', () => {
        const start = new Date();
        start.setDate(start.getDate() - 3);

        const records = queryRecords(testUserId, { start, poopType: 4 });
        records.forEach(r => {
            expect(r.poopType).toBe(4);
        });
    });

    test('不存在的用户应返回空数组', () => {
        const records = queryRecords(999);
        expect(records).toEqual([]);
    });

    test('无筛选条件应返回所有记录', () => {
        const records = queryRecords(testUserId, {});
        expect(records.length).toBe(5);
    });
});

describe('calculateStreak - 连续打卡计算', () => {
    const testUserId = 100;

    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录应返回 1', () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)')
            .run(testUserId, today.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('连续 7 天应返回 7', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)')
                .run(testUserId, d.toISOString(), 4);
        }
        expect(calculateStreak(testUserId)).toBe(7);
    });

    test('中断打卡应返回中断前的天数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)')
                .run(testUserId, d.toISOString(), 4);
        }
        expect(calculateStreak(testUserId)).toBe(3);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)')
            .run(testUserId, yesterday.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('同一天多条记录应只算一天', () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)')
            .run(testUserId, today.toISOString(), 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)')
            .run(testUserId, today.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(1);
    });
});