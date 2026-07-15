process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

let mockDb;
let testUserId;

beforeAll(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
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
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
        CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
    `);

    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = mockDb.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;
});

afterAll(() => {
    mockDb.close();
});

jest.mock('./database', () => ({
    getDb: jest.fn(),
}));

const { getDb } = require('./database');
const { queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('./records');

beforeEach(() => {
    getDb.mockReturnValue(mockDb);
});

describe('queryRecords - 记录查询', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回空数组', () => {
        const records = queryRecords(testUserId);
        expect(records).toEqual([]);
    });

    test('应返回指定用户的所有记录', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-14T10:00:00', 3, '2024-01-14T10:00:00'
        );

        const records = queryRecords(testUserId);
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(3);
    });

    test('应按创建时间降序排序', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T09:00:00', 3, '2024-01-15T09:00:00'
        );

        const records = queryRecords(testUserId);
        expect(records[0].poopType).toBe(3);
        expect(records[1].poopType).toBe(4);
    });

    test('按日期范围筛选应正确', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-10T08:00:00', 4, '2024-01-10T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 3, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-20T08:00:00', 5, '2024-01-20T08:00:00'
        );

        const records = queryRecords(testUserId, { start: '2024-01-12', end: '2024-01-18' });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(3);
    });

    test('按大便类型筛选应正确', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-16T08:00:00', 3, '2024-01-16T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-17T08:00:00', 4, '2024-01-17T08:00:00'
        );

        const records = queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(4);
    });
});

describe('calculateStreak - 连续打卡天数', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录时应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录时应返回 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('连续 7 天打卡应返回 7', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }
        expect(calculateStreak(testUserId)).toBe(7);
    });

    test('中断打卡应返回中断前的天数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(2);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('同一天多条记录应计为一天', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 3, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(1);
    });
});

describe('computeStats - 统计计算', () => {
    test('空记录应返回默认统计', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.avgDuration).toBe(0);
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录应正确计算', () => {
        const records = [
            { date: '2024-01-15T08:30:00', poopType: 4, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.daily.length).toBe(1);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.daily[0].count).toBe(1);
    });

    test('多条记录应正确计算', () => {
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

    test('无 duration 的记录应正确处理', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 0 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(300);
    });

    test('daily 聚合应按日期正确分组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 }
        ];
        const stats = computeStats(records);
        expect(stats.daily.length).toBe(2);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.daily[0].count).toBe(2);
        expect(stats.daily[0].avgDuration).toBe(Math.round((300 + 240) / 2));
        expect(stats.daily[1].date).toBe('2024-01-16');
        expect(stats.daily[1].count).toBe(1);
    });

    test('weekly 聚合应按周正确分组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-22T08:00:00', poopType: 3, duration: 600 }
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(2);
    });

    test('poopType 为 0 应正确计数', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 0, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 }
        ];
        const stats = computeStats(records);
        expect(stats.typeCounts[0]).toBe(1);
        expect(stats.typeCounts[4]).toBe(1);
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    test('空查询应返回空对象', () => {
        const filter = parseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('有效 start 应被解析', () => {
        const filter = parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('无效 start 应被忽略', () => {
        const filter = parseFilterQuery({ start: 'invalid' });
        expect(filter.start).toBeUndefined();
    });

    test('有效 end 应被解析并设置为当天结束时间', () => {
        const filter = parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getFullYear()).toBe(2024);
        expect(filter.end.getMonth()).toBe(0);
        expect(filter.end.getDate()).toBe(15);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
        expect(filter.end.getSeconds()).toBe(59);
    });

    test('有效 poop_type 应被解析', () => {
        const filter = parseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效 poop_type 应被忽略', () => {
        let filter = parseFilterQuery({ poop_type: '0' });
        expect(filter.poopType).toBeUndefined();

        filter = parseFilterQuery({ poop_type: '8' });
        expect(filter.poopType).toBeUndefined();

        filter = parseFilterQuery({ poop_type: 'invalid' });
        expect(filter.poopType).toBeUndefined();
    });

    test('完整筛选条件应正确解析', () => {
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