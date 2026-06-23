'use strict';

process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');

let originalGetDb;
let testDb;
let queryRecords, calculateStreak, computeStats, parseFilterQuery;

beforeAll(() => {
    testDb = new Database(':memory:');

    testDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    const databaseModule = require('./database');
    originalGetDb = databaseModule.getDb;
    databaseModule.getDb = () => testDb;

    ({ queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('./records'));
});

afterAll(() => {
    const databaseModule = require('./database');
    databaseModule.getDb = originalGetDb;
    testDb.close();
});

beforeEach(() => {
    testDb.exec('DELETE FROM records');
    testDb.exec('DELETE FROM users');
    testDb.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)').run(1, 'testuser', 'test@test.com', 'testpass');
    testDb.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)').run(2, 'testuser2', 'test2@test.com', 'testpass');
});

describe('records.js - 查询功能', () => {
    describe('queryRecords - 记录查询', () => {
        test('应返回指定用户的所有记录', () => {
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-15', 4);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-14', 3);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(2, '2024-01-15', 4);

            const records = queryRecords(1);
            expect(records.length).toBe(2);
            expect(records[0].userId).toBe(1);
            expect(records[1].userId).toBe(1);
        });

        test('应按日期范围筛选', () => {
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-10', 4);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-15', 4);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-20', 4);

            const records = queryRecords(1, { start: '2024-01-12', end: '2024-01-18' });
            expect(records.length).toBe(1);
            expect(records[0].date).toBe('2024-01-15');
        });

        test('应按大便类型筛选', () => {
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-15', 4);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-14', 3);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-13', 4);

            const records = queryRecords(1, { poopType: 4 });
            expect(records.length).toBe(2);
            expect(records[0].poopType).toBe(4);
            expect(records[1].poopType).toBe(4);
        });

        test('组合筛选应正确工作', () => {
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-10', 4);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-15', 3);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-15', 4);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-20', 4);

            const records = queryRecords(1, { start: '2024-01-12', end: '2024-01-18', poopType: 4 });
            expect(records.length).toBe(1);
            expect(records[0].date).toBe('2024-01-15');
            expect(records[0].poopType).toBe(4);
        });

        test('无记录应返回空数组', () => {
            const records = queryRecords(999);
            expect(records.length).toBe(0);
        });

        test('日期对象应正确处理', () => {
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, '2024-01-15', 4);

            const start = new Date(2024, 0, 1);
            const end = new Date(2024, 0, 31);
            const records = queryRecords(1, { start, end });
            expect(records.length).toBe(1);
        });
    });

    describe('calculateStreak - 连续打卡计算', () => {
        test('无记录应返回 0', () => {
            expect(calculateStreak(1)).toBe(0);
        });

        test('今天有记录应返回 1', () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = today.toISOString().split('T')[0];
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, todayStr, 4);
            expect(calculateStreak(1)).toBe(1);
        });

        test('连续多天应返回正确天数', () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            for (let i = 0; i < 7; i++) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, d.toISOString().split('T')[0], 4);
            }
            expect(calculateStreak(1)).toBe(7);
        });

        test('中断应返回中断前的天数', () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, today.toISOString().split('T')[0], 4);

            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, yesterday.toISOString().split('T')[0], 4);

            const dayBeforeYesterday = new Date(today);
            dayBeforeYesterday.setDate(today.getDate() - 2);

            expect(calculateStreak(1)).toBe(2);
        });

        test('今天无记录但昨天有应返回 0', () => {
            const yesterday = new Date();
            yesterday.setHours(0, 0, 0, 0);
            yesterday.setDate(yesterday.getDate() - 1);
            testDb.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(1, yesterday.toISOString().split('T')[0], 4);
            expect(calculateStreak(1)).toBe(0);
        });
    });
});

describe('records.js - 统计计算', () => {
    describe('computeStats - 统计数据计算', () => {
        test('空记录应返回零值统计', () => {
            const stats = computeStats([]);
            expect(stats.total).toBe(0);
            expect(stats.typeCounts).toEqual({});
            expect(stats.avgDuration).toBe(0);
            expect(stats.daily.length).toBe(0);
            expect(stats.weekly.length).toBe(0);
        });

        test('单条记录应正确统计', () => {
            const records = [
                { date: '2024-01-15', poopType: 4, duration: 300 }
            ];
            const stats = computeStats(records);
            expect(stats.total).toBe(1);
            expect(stats.typeCounts[4]).toBe(1);
            expect(stats.avgDuration).toBe(300);
            expect(stats.daily.length).toBe(1);
            expect(stats.daily[0].date).toBe('2024-01-15');
            expect(stats.daily[0].count).toBe(1);
        });

        test('多条记录应正确聚合', () => {
            const records = [
                { date: '2024-01-15', poopType: 4, duration: 300 },
                { date: '2024-01-15', poopType: 3, duration: 120 },
                { date: '2024-01-14', poopType: 4, duration: 240 },
                { date: '2024-01-13', poopType: 5, duration: 180 }
            ];
            const stats = computeStats(records);
            expect(stats.total).toBe(4);
            expect(stats.typeCounts[4]).toBe(2);
            expect(stats.typeCounts[3]).toBe(1);
            expect(stats.typeCounts[5]).toBe(1);
            expect(stats.avgDuration).toBe(Math.round((300 + 120 + 240 + 180) / 4));
            expect(stats.daily.length).toBe(3);
        });

        test('无时长记录应正确处理', () => {
            const records = [
                { date: '2024-01-15', poopType: 4, duration: 300 },
                { date: '2024-01-14', poopType: 3, duration: null },
                { date: '2024-01-13', poopType: 4, duration: 0 }
            ];
            const stats = computeStats(records);
            expect(stats.total).toBe(3);
            expect(stats.avgDuration).toBe(300);
            expect(stats.daily[0].avgDuration).toBe(0);
            expect(stats.daily[2].avgDuration).toBe(300);
        });

        test('无效日期应被忽略', () => {
            const records = [
                { date: '2024-01-15', poopType: 4, duration: 300 },
                { date: 'invalid', poopType: 3, duration: 120 }
            ];
            const stats = computeStats(records);
            expect(stats.total).toBe(2);
            expect(stats.daily.length).toBe(1);
        });

        test('每周统计应正确聚合', () => {
            const records = [
                { date: '2024-01-15', poopType: 4, duration: 300 },
                { date: '2024-01-16', poopType: 3, duration: 120 },
                { date: '2024-01-22', poopType: 4, duration: 240 }
            ];
            const stats = computeStats(records);
            expect(stats.weekly.length).toBe(2);
        });
    });

    describe('parseFilterQuery - 筛选参数解析', () => {
        test('应解析 start 日期', () => {
            const filter = parseFilterQuery({ start: '2024-01-15' });
            expect(filter.start).not.toBeNull();
            expect(filter.start.getFullYear()).toBe(2024);
            expect(filter.start.getMonth()).toBe(0);
            expect(filter.start.getDate()).toBe(15);
        });

        test('应解析 end 日期并设置为 23:59:59', () => {
            const filter = parseFilterQuery({ end: '2024-01-15' });
            expect(filter.end).not.toBeNull();
            expect(filter.end.getHours()).toBe(23);
            expect(filter.end.getMinutes()).toBe(59);
            expect(filter.end.getSeconds()).toBe(59);
        });

        test('应解析有效大便类型', () => {
            const filter = parseFilterQuery({ poop_type: '4' });
            expect(filter.poopType).toBe(4);
        });

        test('无效日期应被忽略', () => {
            const filter = parseFilterQuery({ start: 'invalid', end: 'invalid' });
            expect(filter.start).toBeUndefined();
            expect(filter.end).toBeUndefined();
        });

        test('无效大便类型应被忽略', () => {
            const filter = parseFilterQuery({ poop_type: '0' });
            expect(filter.poopType).toBeUndefined();

            const filter2 = parseFilterQuery({ poop_type: '8' });
            expect(filter2.poopType).toBeUndefined();

            const filter3 = parseFilterQuery({ poop_type: 'invalid' });
            expect(filter3.poopType).toBeUndefined();
        });

        test('空对象应返回空筛选', () => {
            const filter = parseFilterQuery({});
            expect(Object.keys(filter).length).toBe(0);
        });

        test('ISO 格式日期应正确解析', () => {
            const filter = parseFilterQuery({ start: '2024-01-15T08:30:00Z' });
            expect(filter.start).not.toBeNull();
            expect(filter.start.getFullYear()).toBe(2024);
        });
    });
});