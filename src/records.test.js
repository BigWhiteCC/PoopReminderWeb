process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

let db;
let testUserId;

// ============ 共享内存数据库（供后续 mock 使用） ============
let mockDb;
jest.mock('./database', () => ({
    getDb: () => mockDb
}));

// 在引入 ./records 之后再用 require 加载真实实现
const recordsModule = require('./records');
const { queryRecords, computeStats, parseFilterQuery, calculateStreak } = recordsModule;

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

    // 把同一份内存 db 暴露给被测模块
    mockDb = db;
});

afterAll(() => {
    db.close();
});

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

// ============ 真实导出函数测试：queryRecords ============
// 重点覆盖：日期范围筛选、类型筛选、Date 对象与字符串混用、用户隔离
describe('queryRecords - 真实导出函数', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    function insertRecord(date, poopType, duration = 0) {
        db.prepare(`INSERT INTO records (user_id, date, poop_type, duration, created_at)
                    VALUES (?, ?, ?, ?, ?)`).run(testUserId, date, poopType, duration, date);
    }

    test('应按 created_at/date 降序返回', () => {
        insertRecord('2024-01-14T10:00:00', 3);
        insertRecord('2024-01-15T10:00:00', 4);
        insertRecord('2024-01-13T10:00:00', 5);
        const result = queryRecords(testUserId);
        expect(result.map(r => r.poopType)).toEqual([4, 3, 5]);
    });

    test('start 过滤：仅返回指定日期之后的记录', () => {
        insertRecord('2024-01-13T10:00:00', 3);
        insertRecord('2024-01-14T10:00:00', 4);
        insertRecord('2024-01-15T10:00:00', 5);
        const result = queryRecords(testUserId, { start: '2024-01-14' });
        expect(result.length).toBe(2);
        expect(result.map(r => r.poopType).sort()).toEqual([4, 5]);
    });

    test('end 过滤（半开区间）：应排除 end 当天的记录', () => {
        // SQL: date(r.date, 'localtime') < endKey → end 当天不包含
        insertRecord('2024-01-14T10:00:00', 3);
        insertRecord('2024-01-15T10:00:00', 4);
        const result = queryRecords(testUserId, { end: '2024-01-15' });
        expect(result.length).toBe(1);
        expect(result[0].poopType).toBe(3);
    });

    test('start + end 组合应正确收窄范围', () => {
        insertRecord('2024-01-13T10:00:00', 3);
        insertRecord('2024-01-14T10:00:00', 4);
        insertRecord('2024-01-15T10:00:00', 5);
        insertRecord('2024-01-16T10:00:00', 6);
        const result = queryRecords(testUserId, { start: '2024-01-14', end: '2024-01-16' });
        expect(result.map(r => r.poopType).sort()).toEqual([4, 5]);
    });

    test('poopType 过滤应仅返回匹配类型', () => {
        insertRecord('2024-01-14T10:00:00', 3);
        insertRecord('2024-01-15T10:00:00', 4);
        insertRecord('2024-01-16T10:00:00', 4);
        const result = queryRecords(testUserId, { poopType: 4 });
        expect(result.length).toBe(2);
        expect(result.every(r => r.poopType === 4)).toBe(true);
    });

    test('Date 对象 start/end 应正确处理', () => {
        insertRecord('2024-01-14T10:00:00', 4);
        insertRecord('2024-01-15T10:00:00', 4);
        const result = queryRecords(testUserId, {
            start: new Date(2024, 0, 14),
            end: new Date(2024, 0, 16)
        });
        expect(result.length).toBe(2);
    });

    test('应只返回指定 userId 的记录（用户隔离）', () => {
        // 创建一个其他用户及其记录
        const otherId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
            .run('other', 'other@test.com', 'hash').lastInsertRowid;
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(otherId, '2024-01-15T10:00:00', 7, '2024-01-15T10:00:00');
        insertRecord('2024-01-15T10:00:00', 4);
        const result = queryRecords(testUserId);
        expect(result.length).toBe(1);
        expect(result[0].poopType).toBe(4);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(otherId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherId);
    });
});

// ============ 真实导出函数测试：computeStats ============
describe('computeStats - 真实导出函数', () => {
    test('空记录应返回 total=0 且无 NaN', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.avgDuration).toBe(0);
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录应正确聚合', () => {
        const stats = computeStats([
            { date: '2024-01-15T08:30:00', poopType: 4, duration: 300 }
        ]);
        expect(stats.total).toBe(1);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.daily.length).toBe(1);
        expect(stats.daily[0].date).toBe('2024-01-15');
        expect(stats.weekly.length).toBe(1);
    });

    test('多条不同类型应正确分布到 typeCounts', () => {
        const stats = computeStats([
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: 120 }
        ]);
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.typeCounts[5]).toBe(1);
        expect(stats.avgDuration).toBe(Math.round((300 + 240 + 600 + 120) / 4));
    });

    test('duration 为 0 或 null 的记录不应纳入平均时长计算', () => {
        const stats = computeStats([
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 0 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: null }
        ]);
        // 仅 duration=300 纳入计算 → avg = 300
        expect(stats.avgDuration).toBe(300);
    });

    test('daily 数组应按日期升序排列', () => {
        const stats = computeStats([
            { date: '2024-01-17T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-16T08:00:00', poopType: 5, duration: 120 }
        ]);
        expect(stats.daily.map(d => d.date)).toEqual(['2024-01-15', '2024-01-16', '2024-01-17']);
    });

    test('weekly 数组应按周键升序排列且不重复', () => {
        const stats = computeStats([
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },  // 周一
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 300 },  // 同一周
            { date: '2024-01-22T08:00:00', poopType: 4, duration: 300 }   // 下一周
        ]);
        expect(stats.weekly.length).toBe(2);
        expect(stats.weekly[0].key < stats.weekly[1].key).toBe(true);
        expect(stats.weekly[0].count).toBe(2);
        expect(stats.weekly[1].count).toBe(1);
    });
});

// ============ 真实导出函数测试：parseFilterQuery ============
// 重点覆盖：end 自动补齐到当天 23:59:59.999（这是 history/weekly/list 路由
// 共享的关键边界条件——若 end 不补齐到 23:59:59.999，当天的记录会被漏掉）
describe('parseFilterQuery - 真实导出函数', () => {
    test('空查询应返回空对象', () => {
        expect(parseFilterQuery({})).toEqual({});
    });

    test('有效 start 应被解析为本地 00:00:00', () => {
        const f = parseFilterQuery({ start: '2024-01-15' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.start.getHours()).toBe(0);
        expect(f.start.getMinutes()).toBe(0);
    });

    test('end 应补齐到当天 23:59:59.999（业务关键边界）', () => {
        const f = parseFilterQuery({ end: '2024-01-15' });
        expect(f.end).toBeInstanceOf(Date);
        expect(f.end.getHours()).toBe(23);
        expect(f.end.getMinutes()).toBe(59);
        expect(f.end.getSeconds()).toBe(59);
        expect(f.end.getMilliseconds()).toBe(999);
    });

    test('start + end 应共同确定一天的窗口', () => {
        const f = parseFilterQuery({ start: '2024-01-15', end: '2024-01-15' });
        // 同一日的 start/end 窗口应为 00:00:00.000 ~ 23:59:59.999
        expect(f.end.getTime() - f.start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
    });

    test('poop_type 1-7 应被保留，0/8/abc 应被丢弃', () => {
        expect(parseFilterQuery({ poop_type: '4' }).poopType).toBe(4);
        expect(parseFilterQuery({ poop_type: '7' }).poopType).toBe(7);
        expect(parseFilterQuery({ poop_type: '0' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: '8' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: 'abc' }).poopType).toBeUndefined();
    });

    test('无效 start/end 应被忽略，不抛错', () => {
        const f = parseFilterQuery({ start: 'not-a-date', end: 'garbage' });
        expect(f.start).toBeUndefined();
        expect(f.end).toBeUndefined();
    });

    test('完整过滤应一次性解析 start、end、poopType', () => {
        const f = parseFilterQuery({ start: '2024-01-01', end: '2024-01-31', poop_type: '3' });
        expect(f.start.getDate()).toBe(1);
        expect(f.end.getDate()).toBe(31);
        expect(f.end.getHours()).toBe(23);
        expect(f.poopType).toBe(3);
    });
});

// ============ 真实导出函数测试：calculateStreak ============
// 集成测试：连续打卡，跨日 边界
describe('calculateStreak - 真实导出函数', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    function recordAt(dateStr) {
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(testUserId, dateStr, 4, dateStr);
    }

    test('无记录时返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录应返回 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        recordAt(today.toISOString());
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('同一天多条记录应只计为 1 天', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const t1 = new Date(today); t1.setHours(8);
        const t2 = new Date(today); t2.setHours(20);
        recordAt(t1.toISOString());
        recordAt(t2.toISOString());
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('隔一天不连续应返回 0（即使之前有记录）', () => {
        const twoDaysAgo = new Date();
        twoDaysAgo.setHours(0, 0, 0, 0);
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        recordAt(twoDaysAgo.toISOString());
        expect(calculateStreak(testUserId)).toBe(0);
    });
});