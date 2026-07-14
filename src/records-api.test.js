/**
 * 实际 src/records.js 函数的单元测试
 * 重点覆盖：queryRecords（按用户/日期/类型筛选）、calculateStreak（连续打卡边界）、
 * computeStats（按日/按周聚合）、parseFilterQuery（筛选参数解析）
 *
 * 通过 jest.mock 替换 ./database 的 getDb，注入内存数据库进行隔离测试。
 */

const Database = require('better-sqlite3');

// 准备内存数据库，在 mock 之前建立，以便在 factory 中复用
const mockDb = new Database(':memory:');
mockDb.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        password_changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE records (
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
    CREATE INDEX idx_records_user_id ON records(user_id);
`);

jest.mock('../src/database', () => ({
    getDb: () => mockDb,
    addLoginLog: jest.fn(),
    addAuditLog: jest.fn()
}));

const { queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('../src/records');
const testDb = mockDb;

let testUserId;
let otherUserId;

beforeAll(() => {
    const u1 = testDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('u1', 'u1@test.com', 'h');
    testUserId = u1.lastInsertRowid;
    const u2 = testDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('u2', 'u2@test.com', 'h');
    otherUserId = u2.lastInsertRowid;
});

afterAll(() => {
    testDb.close();
});

function clearRecords() {
    testDb.prepare('DELETE FROM records').run();
}

function insertRecord(userId, date, poopType = 4, duration = 300, createdAt = null) {
    const ca = createdAt || new Date().toISOString();
    return testDb.prepare(
        'INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, date, poopType, duration, ca).lastInsertRowid;
}

describe('queryRecords - 实际函数', () => {
    beforeEach(clearRecords);

    test('无记录应返回空数组', () => {
        expect(queryRecords(testUserId)).toEqual([]);
    });

    test('应只返回指定用户的记录（数据隔离）', () => {
        insertRecord(testUserId, '2024-01-15T08:00:00', 4);
        insertRecord(testUserId, '2024-01-14T08:00:00', 3);
        insertRecord(otherUserId, '2024-01-15T09:00:00', 5); // 其他用户

        const records = queryRecords(testUserId);
        expect(records.length).toBe(2);
        records.forEach(r => expect(r.userId).toBe(testUserId));
    });

    test('应将数据库字段映射为驼峰命名', () => {
        insertRecord(testUserId, '2024-01-15T08:00:00', 4, 300);
        const records = queryRecords(testUserId);
        expect(records[0]).toHaveProperty('poopType', 4);
        expect(records[0]).toHaveProperty('userId', testUserId);
        expect(records[0].device).toBeDefined();
    });

    test('应支持 start 日期筛选（包含）', () => {
        insertRecord(testUserId, '2024-01-10T08:00:00', 4);
        insertRecord(testUserId, '2024-01-15T08:00:00', 3);
        insertRecord(testUserId, '2024-01-20T08:00:00', 5);

        const records = queryRecords(testUserId, { start: new Date(2024, 0, 15) });
        expect(records.length).toBe(2);
    });

    test('应支持 end 日期筛选（不包含当日）', () => {
        insertRecord(testUserId, '2024-01-10T08:00:00', 4);
        insertRecord(testUserId, '2024-01-15T08:00:00', 3);
        insertRecord(testUserId, '2024-01-20T08:00:00', 5);

        // end < 日期，即不含 20 号
        const records = queryRecords(testUserId, { end: new Date(2024, 0, 20) });
        expect(records.length).toBe(2);
    });

    test('应支持 poopType 筛选', () => {
        insertRecord(testUserId, '2024-01-15T08:00:00', 4);
        insertRecord(testUserId, '2024-01-15T12:00:00', 5);
        insertRecord(testUserId, '2024-01-15T18:00:00', 4);

        const records = queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(2);
        records.forEach(r => expect(r.poopType).toBe(4));
    });

    test('应按 created_at 降序返回', () => {
        insertRecord(testUserId, '2024-01-15T08:00:00', 4, 300, '2024-01-15T08:00:00');
        insertRecord(testUserId, '2024-01-15T10:00:00', 5, 300, '2024-01-15T10:00:00');

        const records = queryRecords(testUserId);
        // created_at 较新的排在前面
        expect(records[0].poopType).toBe(5);
    });
});

describe('calculateStreak - 实际函数', () => {
    beforeEach(clearRecords);

    test('无记录应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('只有今天有记录应返回 1', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        insertRecord(testUserId, today.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('连续 5 天打卡应返回 5', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        for (let i = 0; i < 5; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            insertRecord(testUserId, d.toISOString(), 4);
        }
        expect(calculateStreak(testUserId)).toBe(5);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(12, 0, 0, 0);
        insertRecord(testUserId, yesterday.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('同一天多条记录应只计为 1 天', () => {
        const today = new Date();
        today.setHours(8, 0, 0, 0);
        insertRecord(testUserId, today.toISOString(), 4);
        insertRecord(testUserId, today.toISOString(), 3);
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('中断后重连：从中断点开始计数', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        // 今天 + 昨天连续两天
        insertRecord(testUserId, today.toISOString(), 4);
        const y = new Date(today);
        y.setDate(today.getDate() - 1);
        insertRecord(testUserId, y.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(2);
    });
});

describe('computeStats - 实际函数', () => {
    test('空记录应返回全零统计', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.avgDuration).toBe(0);
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('应正确统计各类型数量与平均时长', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 600 },
            { date: '2024-01-16T08:00:00', poopType: 5, duration: 0 },
            { date: '2024-01-16T20:00:00', poopType: 3, duration: 120 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(4);
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[5]).toBe(1);
        expect(stats.typeCounts[3]).toBe(1);
        // 平均时长只算 duration > 0 的：(300+600+120)/3 = 340
        expect(stats.avgDuration).toBe(340);
    });

    test('duration 为 0 或缺失应被排除在平均时长外', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 0 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: null },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 200 }
        ];
        const stats = computeStats(records);
        expect(stats.avgDuration).toBe(200);
    });

    test('应按日聚合生成 daily 数组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T20:00:00', poopType: 3, duration: 180 },
            { date: '2024-01-16T08:00:00', poopType: 5, duration: 240 }
        ];
        const stats = computeStats(records);
        expect(stats.daily.length).toBe(2);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.daily[0].count).toBe(2);
        expect(stats.daily[0].avgDuration).toBe(240); // (300+180)/2
        expect(stats.daily[1].date).toBe('2024-01-16');
        expect(stats.daily[1].count).toBe(1);
    });

    test('应按周聚合生成 weekly 数组', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 }, // 周一
            { date: '2024-01-17T08:00:00', poopType: 3, duration: 240 }, // 周三（同周）
            { date: '2024-01-22T08:00:00', poopType: 5, duration: 180 }  // 下周一
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(2);
        // 周聚合应按时间排序
        expect(stats.weekly[0].count).toBe(2);
        expect(stats.weekly[1].count).toBe(1);
    });

    test('poopType 为 0 应归入 typeCounts[0]', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 0, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: null, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.typeCounts[0]).toBe(2);
    });
});

describe('parseFilterQuery - 实际函数', () => {
    test('空查询应返回空对象', () => {
        expect(parseFilterQuery({})).toEqual({});
    });

    test('应解析有效 start 日期', () => {
        const f = parseFilterQuery({ start: '2024-01-15' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.start.getFullYear()).toBe(2024);
    });

    test('应将 end 时间设置为当日 23:59:59.999（覆盖全天）', () => {
        const f = parseFilterQuery({ end: '2024-01-15' });
        expect(f.end).toBeInstanceOf(Date);
        expect(f.end.getHours()).toBe(23);
        expect(f.end.getMinutes()).toBe(59);
        expect(f.end.getSeconds()).toBe(59);
    });

    test('应接受完整 ISO 字符串作为 start', () => {
        const f = parseFilterQuery({ start: '2024-01-15T08:30:00+08:00' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.start.getFullYear()).toBe(2024);
    });

    test('应解析合法范围内的 poop_type', () => {
        expect(parseFilterQuery({ poop_type: '4' }).poopType).toBe(4);
        expect(parseFilterQuery({ poop_type: '7' }).poopType).toBe(7);
        expect(parseFilterQuery({ poop_type: '1' }).poopType).toBe(1);
    });

    test('应忽略超出范围的 poop_type（< 1 或 > 7）', () => {
        expect(parseFilterQuery({ poop_type: '0' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: '8' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: '99' }).poopType).toBeUndefined();
    });

    test('应忽略无效日期字符串', () => {
        const f = parseFilterQuery({ start: 'not-a-date', end: 'invalid' });
        expect(f.start).toBeUndefined();
        expect(f.end).toBeUndefined();
    });

    test('应同时解析所有有效字段', () => {
        const f = parseFilterQuery({ start: '2024-01-15', end: '2024-01-20', poop_type: '4' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.end).toBeInstanceOf(Date);
        expect(f.poopType).toBe(4);
    });
});
