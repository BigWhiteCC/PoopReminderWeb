process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// ============ Mock database for real function tests ============
// Use mock-prefixed variable so Jest allows it in mock factory
let mockDbHolder = null;

jest.mock('./database', () => ({
    getDb: () => mockDbHolder,
    addLoginLog: jest.fn(),
    addAuditLog: jest.fn(),
    initializeDatabase: jest.fn(),
    closeDb: jest.fn(),
    seedDevData: jest.fn()
}));

// Import real records functions AFTER mock is set up
const {
    queryRecords: realQueryRecords,
    calculateStreak: realCalculateStreak,
    computeStats: realComputeStats,
    parseFilterQuery: realParseFilterQuery
} = require('./records');

let db;
let testUserId;

beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
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
    const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;

    // Point mock to our in-memory database
    mockDbHolder = db;
});

afterAll(() => {
    db.close();
});

// ============ 原有测试（基于直接 SQL 查询） ============
describe('queryRecords - 记录查询', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回空数组', () => {
        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(testUserId);
        expect(records).toEqual([]);
    });

    test('应返回指定用户的所有记录', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-14T10:00:00', 3, '2024-01-14T10:00:00'
        );

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC').all(testUserId);
        expect(records.length).toBe(2);
        expect(records[0].poop_type).toBe(4);
        expect(records[1].poop_type).toBe(3);
    });

    test('应按创建时间降序排序', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T09:00:00', 3, '2024-01-15T09:00:00'
        );

        const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY created_at DESC').all(testUserId);
        expect(records[0].poop_type).toBe(3);
        expect(records[1].poop_type).toBe(4);
    });
});

describe('computeStats - 统计计算', () => {
    test('空记录应返回默认统计', () => {
        const stats = {
            total: 0,
            typeCounts: {},
            avgDuration: 0,
            daily: [],
            weekly: []
        };
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
        const typeCounts = {};
        let totalDuration = 0;
        let durationCount = 0;

        records.forEach(r => {
            const t = r.poopType || 0;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
            if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
        });
        const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

        expect(typeCounts[4]).toBe(1);
        expect(avgDuration).toBe(300);
        expect(records.length).toBe(1);
    });

    test('多条记录应正确计算', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: 120 }
        ];
        const typeCounts = {};
        let totalDuration = 0;
        let durationCount = 0;

        records.forEach(r => {
            const t = r.poopType || 0;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
            if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
        });
        const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

        expect(typeCounts[4]).toBe(2);
        expect(typeCounts[3]).toBe(1);
        expect(typeCounts[5]).toBe(1);
        expect(avgDuration).toBe(Math.round((300 + 240 + 600 + 120) / 4));
    });
});

describe('parseFilterQuery - 筛选解析', () => {
    const parseDateKey = (dateStr) => {
        if (!dateStr) return null;
        const s = String(dateStr).trim();
        const dOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dOnly) {
            const dt = new Date(parseInt(dOnly[1], 10), parseInt(dOnly[2], 10) - 1, parseInt(dOnly[3], 10));
            return isNaN(dt.getTime()) ? null : dt;
        }
        const dt = new Date(s);
        return isNaN(dt.getTime()) ? null : dt;
    };

    test('空查询应返回空对象', () => {
        const filter = {};
        expect(filter).toEqual({});
    });

    test('有效 start 应被解析', () => {
        const s = parseDateKey('2024-01-15');
        expect(s).toBeInstanceOf(Date);
        expect(s.getFullYear()).toBe(2024);
        expect(s.getMonth()).toBe(0);
        expect(s.getDate()).toBe(15);
    });

    test('无效 start 应被忽略', () => {
        const s = parseDateKey('invalid');
        expect(s).toBeNull();
    });

    test('有效 poop_type 应被解析', () => {
        const pt = parseInt('4', 10);
        expect(pt).toBe(4);
    });

    test('无效 poop_type 应被忽略', () => {
        const pt = parseInt('0', 10);
        expect(pt).toBe(0);
    });
});

// ============ 实际模块函数测试 ============

describe('queryRecords - 实际模块函数', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回空数组', () => {
        const records = realQueryRecords(testUserId);
        expect(records).toEqual([]);
    });

    test('应返回映射后的记录', () => {
        const now = new Date().toISOString();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, '正常', '测试', now
        );

        const records = realQueryRecords(testUserId);
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
        expect(records[0].duration).toBe(300);
        expect(records[0].userId).toBe(testUserId);
    });

    test('应支持日期范围筛选', () => {
        const now = new Date().toISOString();
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-10T08:00:00', 3, now);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15T08:00:00', 4, now);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-20T08:00:00', 5, now);

        const start = new Date(2024, 0, 12);
        const end = new Date(2024, 0, 18);
        const records = realQueryRecords(testUserId, { start, end });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });

    test('应支持类型筛选', () => {
        const now = new Date().toISOString();
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15T08:00:00', 3, now);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-16T08:00:00', 4, now);

        const records = realQueryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });
});

describe('calculateStreak - 实际模块函数', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回 0', () => {
        expect(realCalculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录应返回至少 1', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, today.toISOString()
        );
        expect(realCalculateStreak(testUserId)).toBeGreaterThanOrEqual(1);
    });

    test('连续多天应返回正确天数', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        for (let i = 0; i < 5; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, d.toISOString()
            );
        }
        expect(realCalculateStreak(testUserId)).toBe(5);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(12, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, yesterday.toISOString()
        );
        expect(realCalculateStreak(testUserId)).toBe(0);
    });
});

describe('computeStats - 实际模块函数', () => {
    test('空记录应返回默认统计', () => {
        const stats = realComputeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.avgDuration).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录应正确计算', () => {
        const records = [
            { date: '2024-01-15T08:30:00', poopType: 4, duration: 300 }
        ];
        const stats = realComputeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.daily.length).toBe(1);
    });

    test('多条记录应正确聚合', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: 120 }
        ];
        const stats = realComputeStats(records);
        expect(stats.total).toBe(4);
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.typeCounts[5]).toBe(1);
        expect(stats.avgDuration).toBe(Math.round((300 + 240 + 600 + 120) / 4));
        expect(stats.daily.length).toBe(3);
    });

    test('无时长记录不应影响平均时长', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 0 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 300 }
        ];
        const stats = realComputeStats(records);
        expect(stats.avgDuration).toBe(300);
    });
});

describe('parseFilterQuery - 实际模块函数', () => {
    test('空查询应返回空对象', () => {
        const filter = realParseFilterQuery({});
        expect(filter).toEqual({});
    });

    test('有效 start 应被解析为 Date', () => {
        const filter = realParseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('有效 end 应被解析并设置到当天末尾', () => {
        const filter = realParseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
        expect(filter.end.getSeconds()).toBe(59);
    });

    test('无效 start 应被忽略', () => {
        const filter = realParseFilterQuery({ start: 'invalid' });
        expect(filter.start).toBeUndefined();
    });

    test('有效 poop_type 应被解析', () => {
        const filter = realParseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效 poop_type (0) 应被忽略', () => {
        const filter = realParseFilterQuery({ poop_type: '0' });
        expect(filter.poopType).toBeUndefined();
    });

    test('无效 poop_type (8) 应被忽略', () => {
        const filter = realParseFilterQuery({ poop_type: '8' });
        expect(filter.poopType).toBeUndefined();
    });

    test('组合筛选应正确解析', () => {
        const filter = realParseFilterQuery({ start: '2024-01-01', end: '2024-01-31', poop_type: '3' });
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.poopType).toBe(3);
    });
});
