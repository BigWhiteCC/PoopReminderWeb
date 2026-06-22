const Database = require('better-sqlite3');

const TEST_DB_PATH = ':memory:';
let db;
let testUserId;

beforeAll(() => {
    db = new Database(TEST_DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            enabled INTEGER DEFAULT 1
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

    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', 'hashed');
    testUserId = result.lastInsertRowid;
});

afterAll(() => {
    db.close();
});

describe('queryRecords - 记录查询', () => {
    let queryRecords;

    beforeEach(() => {
        jest.resetModules();
        const mockDb = { getDb: () => db };
        jest.doMock('./database', () => mockDb);
        queryRecords = require('./records').queryRecords;
        db.prepare('DELETE FROM records').run();
    });

    test('无记录应返回空数组', () => {
        const records = queryRecords(testUserId);
        expect(Array.isArray(records)).toBe(true);
        expect(records.length).toBe(0);
    });

    test('应返回用户的所有记录', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(testUserId, '2024-01-15', 4, 300, '2024-01-15T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(testUserId, '2024-01-16', 3, 420, '2024-01-16T11:00:00');

        const records = queryRecords(testUserId);
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(3);
        expect(records[1].poopType).toBe(4);
    });

    test('应按日期降序排列', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15', 4, '2024-01-15T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-14', 3, '2024-01-14T10:00:00');

        const records = queryRecords(testUserId);
        expect(records[0].date).toContain('2024-01-15');
        expect(records[1].date).toContain('2024-01-14');
    });

    test('应过滤指定日期范围', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-10', 4, '2024-01-10T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15', 3, '2024-01-15T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-20', 5, '2024-01-20T10:00:00');

        const start = new Date(2024, 0, 12);
        const end = new Date(2024, 0, 18);
        const records = queryRecords(testUserId, { start, end });

        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(3);
    });

    test('应过滤指定大便类型', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15', 4, '2024-01-15T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-16', 3, '2024-01-16T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-17', 4, '2024-01-17T10:00:00');

        const records = queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(4);
    });

    test('不应返回其他用户的记录', () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other', 'other@test.com', 'hashed').lastInsertRowid;
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15', 4, '2024-01-15T10:00:00');
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(otherUserId, '2024-01-15', 3, '2024-01-15T10:00:00');

        const records = queryRecords(testUserId);
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });
});

describe('computeStats - 统计计算', () => {
    let computeStats;

    beforeEach(() => {
        jest.resetModules();
        computeStats = require('./records').computeStats;
    });

    test('空记录应返回默认统计', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.avgDuration).toBe(0);
        expect(Object.keys(stats.typeCounts).length).toBe(0);
        expect(stats.daily.length).toBe(0);
        expect(stats.weekly.length).toBe(0);
    });

    test('应正确计算总数和平均时长', () => {
        const records = [
            { date: '2024-01-15', poopType: 4, duration: 300 },
            { date: '2024-01-16', poopType: 3, duration: 420 },
            { date: '2024-01-17', poopType: 4, duration: 240 }
        ];
        const stats = computeStats(records);

        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(Math.round((300 + 420 + 240) / 3));
    });

    test('应正确计算类型分布', () => {
        const records = [
            { date: '2024-01-15', poopType: 4, duration: 300 },
            { date: '2024-01-16', poopType: 3, duration: 420 },
            { date: '2024-01-17', poopType: 4, duration: 240 },
            { date: '2024-01-18', poopType: 5, duration: 180 }
        ];
        const stats = computeStats(records);

        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.typeCounts[5]).toBe(1);
    });

    test('应正确按日期聚合', () => {
        const records = [
            { date: '2024-01-15', poopType: 4, duration: 300 },
            { date: '2024-01-15', poopType: 3, duration: 150 },
            { date: '2024-01-16', poopType: 4, duration: 240 }
        ];
        const stats = computeStats(records);

        expect(stats.daily.length).toBe(2);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.daily[0].count).toBe(2);
        expect(stats.daily[1].date).toBe('2024-01-16');
        expect(stats.daily[1].count).toBe(1);
    });

    test('无时长记录应正确处理', () => {
        const records = [
            { date: '2024-01-15', poopType: 4, duration: null },
            { date: '2024-01-16', poopType: 3, duration: 300 }
        ];
        const stats = computeStats(records);

        expect(stats.total).toBe(2);
        expect(stats.avgDuration).toBe(300);
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    let parseFilterQuery;

    beforeEach(() => {
        jest.resetModules();
        parseFilterQuery = require('./records').parseFilterQuery;
    });

    test('空查询应返回空对象', () => {
        const filter = parseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('应解析有效的开始日期', () => {
        const filter = parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('应解析有效的结束日期', () => {
        const filter = parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getFullYear()).toBe(2024);
        expect(filter.end.getMonth()).toBe(0);
        expect(filter.end.getDate()).toBe(15);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
    });

    test('应解析有效的大便类型', () => {
        const filter = parseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效日期应被忽略', () => {
        const filter = parseFilterQuery({ start: 'invalid', end: '2024-01-15' });
        expect(filter.start).toBeUndefined();
        expect(filter.end).toBeDefined();
    });

    test('无效大便类型应被忽略', () => {
        const filter = parseFilterQuery({ poop_type: '0', start: '2024-01-15' });
        expect(filter.poopType).toBeUndefined();
        expect(filter.start).toBeDefined();
    });

    test('超出范围的大便类型应被忽略', () => {
        const filter = parseFilterQuery({ poop_type: '8' });
        expect(filter.poopType).toBeUndefined();
    });

    test('应同时解析多个筛选条件', () => {
        const filter = parseFilterQuery({
            start: '2024-01-01',
            end: '2024-01-31',
            poop_type: '4'
        });
        expect(filter.start).toBeDefined();
        expect(filter.end).toBeDefined();
        expect(filter.poopType).toBe(4);
    });
});