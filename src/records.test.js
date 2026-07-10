process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const mockDb = new Database(':memory:');
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
const testUserId = result.lastInsertRowid;

jest.mock('./database', () => ({
    getDb: () => mockDb
}));

const testUtils = require('./utils');
const testRecords = require('./records');

afterAll(() => {
    mockDb.close();
});

describe('queryRecords - 记录查询', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回空数组', () => {
        const records = testRecords.queryRecords(testUserId);
        expect(records).toEqual([]);
    });

    test('应返回指定用户的所有记录', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-14T10:00:00', 3, '2024-01-14T10:00:00'
        );

        const records = testRecords.queryRecords(testUserId);
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(3);
    });

    test('应按创建时间降序排序，created_at 优先', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T09:00:00', 3, '2024-01-15T09:00:00'
        );

        const records = testRecords.queryRecords(testUserId);
        expect(records[0].poopType).toBe(3);
        expect(records[1].poopType).toBe(4);
    });

    test('start 参数应过滤起始日期', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-10T08:00:00', 4, '2024-01-10T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 3, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-20T08:00:00', 5, '2024-01-20T08:00:00'
        );

        const records = testRecords.queryRecords(testUserId, { start: '2024-01-15' });
        expect(records.length).toBe(2);
        expect(records.every(r => testUtils.toDateKey(r.date) >= '2024-01-15')).toBe(true);
    });

    test('end 参数应过滤结束日期（不含）', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-10T08:00:00', 4, '2024-01-10T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 3, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-20T08:00:00', 5, '2024-01-20T08:00:00'
        );

        const records = testRecords.queryRecords(testUserId, { end: '2024-01-20' });
        expect(records.length).toBe(2);
        expect(records.every(r => testUtils.toDateKey(r.date) < '2024-01-20')).toBe(true);
    });

    test('poopType 参数应按类型过滤', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-16T08:00:00', 3, '2024-01-16T08:00:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-17T08:00:00', 4, '2024-01-17T08:00:00'
        );

        const records = testRecords.queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(2);
        expect(records.every(r => r.poopType === 4)).toBe(true);
    });

    test('start 和 end 同时使用应正确过滤范围', () => {
        for (let i = 10; i <= 20; i++) {
            const dateStr = `2024-01-${String(i).padStart(2, '0')}T08:00:00`;
            mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, dateStr, 4, dateStr
            );
        }

        const records = testRecords.queryRecords(testUserId, { start: '2024-01-13', end: '2024-01-18' });
        expect(records.length).toBe(5);
        expect(records.every(r => {
            const key = testUtils.toDateKey(r.date);
            return key >= '2024-01-13' && key < '2024-01-18';
        })).toBe(true);
    });

    test('Date 对象作为 start/end 参数应支持', () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:00:00', 4, '2024-01-15T08:00:00'
        );

        const start = new Date(2024, 0, 1);
        const end = new Date(2024, 0, 31);
        const records = testRecords.queryRecords(testUserId, { start, end });
        expect(records.length).toBe(1);
    });

    test('记录应正确映射字段名（snake_case -> camelCase）', () => {
        const insertResult = mockDb.prepare('INSERT INTO records (user_id, date, notes, poop_type, duration, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', '测试备注', 4, 300, '正常', '2024-01-15T08:30:00'
        );

        const records = testRecords.queryRecords(testUserId);
        expect(records.length).toBe(1);
        const r = records[0];
        expect(r.id).toBe(insertResult.lastInsertRowid);
        expect(r.userId).toBe(testUserId);
        expect(r.poopType).toBe(4);
        expect(r.duration).toBe(300);
        expect(r.notes).toBe('测试备注');
        expect(r.status).toBe('正常');
    });
});

describe('calculateStreak - 连续打卡天数', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录时应返回 0', () => {
        expect(testRecords.calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录时应至少为 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        expect(testRecords.calculateStreak(testUserId)).toBeGreaterThanOrEqual(1);
    });

    test('连续多天打卡应正确计数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }
        expect(testRecords.calculateStreak(testUserId)).toBe(7);
    });

    test('一天多条记录应只计 1 天', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 3, new Date().toISOString()
        );
        expect(testRecords.calculateStreak(testUserId)).toBe(1);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(testRecords.calculateStreak(testUserId)).toBe(0);
    });
});

describe('computeStats - 统计计算', () => {
    test('空记录应返回默认统计', () => {
        const stats = testRecords.computeStats([]);
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
        const stats = testRecords.computeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.daily.length).toBe(1);
        expect(stats.daily[0].count).toBe(1);
        expect(stats.weekly.length).toBe(1);
        expect(stats.weekly[0].count).toBe(1);
    });

    test('多条记录应正确计算总数和类型分布', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: 120 }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.total).toBe(4);
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.typeCounts[5]).toBe(1);
        expect(stats.avgDuration).toBe(Math.round((300 + 240 + 600 + 120) / 4));
    });

    test('duration 为 0 或空值不应计入平均时长', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 0 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: null }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(300);
    });

    test('按日聚合应正确分组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: 200 },
            { date: '2024-01-16T08:00:00', poopType: 5, duration: 400 }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.daily.length).toBe(2);
        const day1 = stats.daily.find(d => d.date === '2024-01-15');
        expect(day1).toBeDefined();
        expect(day1.count).toBe(2);
        expect(day1.avgDuration).toBe(250);
        const day2 = stats.daily.find(d => d.date === '2024-01-16');
        expect(day2).toBeDefined();
        expect(day2.count).toBe(1);
        expect(day2.avgDuration).toBe(400);
    });

    test('按周聚合应正确分组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 200 },
            { date: '2024-01-22T08:00:00', poopType: 5, duration: 400 }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.weekly.length).toBe(2);
    });

    test('poopType 为 undefined 应计入类型 0', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: undefined, duration: 300 }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.typeCounts[0]).toBe(1);
    });

    test('日统计应按日期升序排列', () => {
        const records = [
            { date: '2024-01-17T08:00:00', poopType: 4, duration: 100 },
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 100 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 100 }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.daily[1].date).toBe('2024-01-16');
        expect(stats.daily[2].date).toBe('2024-01-17');
    });

    test('周统计应按周键升序排列', () => {
        const records = [
            { date: '2024-02-01T08:00:00', poopType: 4, duration: 100 },
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 100 }
        ];
        const stats = testRecords.computeStats(records);
        expect(stats.weekly.length).toBe(2);
        const keys = stats.weekly.map(w => w.key);
        const sorted = [...keys].sort((a, b) => a.localeCompare(b));
        expect(keys).toEqual(sorted);
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    test('空查询应返回空对象', () => {
        const filter = testRecords.parseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('有效 start 日期字符串应被解析为 Date', () => {
        const filter = testRecords.parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('无效 start 应被忽略', () => {
        const filter = testRecords.parseFilterQuery({ start: 'invalid-date' });
        expect(filter.start).toBeUndefined();
    });

    test('有效 end 日期应设置为当天 23:59:59.999', () => {
        const filter = testRecords.parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
        expect(filter.end.getSeconds()).toBe(59);
        expect(filter.end.getMilliseconds()).toBe(999);
    });

    test('无效 end 应被忽略', () => {
        const filter = testRecords.parseFilterQuery({ end: 'not-a-date' });
        expect(filter.end).toBeUndefined();
    });

    test('有效 poop_type 1-7 应被解析', () => {
        for (let i = 1; i <= 7; i++) {
            const filter = testRecords.parseFilterQuery({ poop_type: String(i) });
            expect(filter.poopType).toBe(i);
        }
    });

    test('poop_type 为 0 应被忽略', () => {
        const filter = testRecords.parseFilterQuery({ poop_type: '0' });
        expect(filter.poopType).toBeUndefined();
    });

    test('poop_type 超出 1-7 范围应被忽略', () => {
        expect(testRecords.parseFilterQuery({ poop_type: '8' }).poopType).toBeUndefined();
        expect(testRecords.parseFilterQuery({ poop_type: '-1' }).poopType).toBeUndefined();
    });

    test('poop_type 为非数字应被忽略', () => {
        const filter = testRecords.parseFilterQuery({ poop_type: 'abc' });
        expect(filter.poopType).toBeUndefined();
    });

    test('多个参数应同时解析', () => {
        const filter = testRecords.parseFilterQuery({
            start: '2024-01-01',
            end: '2024-01-31',
            poop_type: '4'
        });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.poopType).toBe(4);
    });

    test('数字类型的 poop_type 也应正确解析', () => {
        const filter = testRecords.parseFilterQuery({ poop_type: 4 });
        expect(filter.poopType).toBe(4);
    });
});
