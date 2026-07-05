process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

let mockDb;
let testUserId;

jest.mock('better-sqlite3', () => {
    const actual = jest.requireActual('better-sqlite3');
    return function MockDatabase(path, options) {
        if (mockDb && path === 'poopreminder.db') {
            return mockDb;
        }
        return new actual(path, options);
    };
});

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

beforeEach(() => {
    mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
});

const { queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('./records');

describe('queryRecords - 记录查询', () => {
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

    test('应支持按日期范围筛选', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-10T08:00:00', 1, '2024-01-10T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-20T08:00:00', 7, '2024-01-20T08:00:00'
        );

        const start = new Date(2024, 0, 12);
        const end = new Date(2024, 0, 18);
        const records = queryRecords(testUserId, { start, end });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });

    test('应支持按大便类型筛选', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-16T08:00:00', 1, '2024-01-16T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-17T08:00:00', 4, '2024-01-17T08:00:00'
        );

        const records = queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(2);
        expect(records.every(r => r.poopType === 4)).toBe(true);
    });

    test('应支持字符串日期参数', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );

        const records = queryRecords(testUserId, { start: '2024-01-01', end: '2024-01-31' });
        expect(records.length).toBe(1);
    });

    test('不应返回其他用户的记录', () => {
        const otherUserId = mockDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other', 'other@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );

        const records = queryRecords(testUserId);
        expect(records.length).toBe(0);

        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(otherUserId);
        mockDb.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });
});

describe('calculateStreak - 连续打卡天数', () => {
    test('无记录时应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录时应返回 1', () => {
        const today = new Date();
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );

        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('连续 3 天打卡应返回 3', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }

        expect(calculateStreak(testUserId)).toBe(3);
    });

    test('中断打卡应从最近连续天数计算', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(today.getDate() - 3);

        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, threeDaysAgo.toISOString(), 4, new Date().toISOString()
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
        expect(stats.daily[0].count).toBe(1);
    });

    test('多条记录应正确计算类型分布和平均时长', () => {
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
    });

    test('按日聚合应正确分组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: 200 },
            { date: '2024-01-16T08:00:00', poopType: 5, duration: 100 }
        ];
        const stats = computeStats(records);
        expect(stats.daily.length).toBe(2);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.daily[0].count).toBe(2);
        expect(stats.daily[1].date).toBe('2024-01-16');
        expect(stats.daily[1].count).toBe(1);
    });

    test('按周聚合应正确分组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-22T08:00:00', poopType: 3, duration: 200 }
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(2);
        expect(stats.weekly[0].count).toBe(1);
        expect(stats.weekly[1].count).toBe(1);
    });

    test('零时长记录不应计入平均时长', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 0 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.avgDuration).toBe(300);
    });

    test('无有效时长记录时平均时长为 0', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 0 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: null }
        ];
        const stats = computeStats(records);
        expect(stats.avgDuration).toBe(0);
    });

    test('poopType 为 0 或假值应计入 typeCounts[0]', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 0, duration: 0 },
            { date: '2024-01-15T12:00:00', poopType: null, duration: 0 }
        ];
        const stats = computeStats(records);
        expect(stats.typeCounts[0]).toBe(2);
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    test('空查询应返回空对象', () => {
        const filter = parseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('有效 start 应被解析为 Date 对象', () => {
        const filter = parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('无效 start 应被忽略', () => {
        const filter = parseFilterQuery({ start: 'invalid-date' });
        expect(filter.start).toBeUndefined();
    });

    test('有效 end 应被解析为当天 23:59:59.999', () => {
        const filter = parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
        expect(filter.end.getSeconds()).toBe(59);
    });

    test('无效 end 应被忽略', () => {
        const filter = parseFilterQuery({ end: 'not-a-date' });
        expect(filter.end).toBeUndefined();
    });

    test('有效 poop_type (1-7) 应被解析', () => {
        const filter = parseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效 poop_type (0) 应被忽略', () => {
        const filter = parseFilterQuery({ poop_type: '0' });
        expect(filter.poopType).toBeUndefined();
    });

    test('无效 poop_type (8) 应被忽略', () => {
        const filter = parseFilterQuery({ poop_type: '8' });
        expect(filter.poopType).toBeUndefined();
    });

    test('非数字 poop_type 应被忽略', () => {
        const filter = parseFilterQuery({ poop_type: 'abc' });
        expect(filter.poopType).toBeUndefined();
    });

    test('应同时解析多个筛选条件', () => {
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
