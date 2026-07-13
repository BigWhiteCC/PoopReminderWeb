process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// ============ 回归缺口：测试实际生产代码 queryRecords / calculateStreak /
//                       computeStats / parseFilterQuery ============
// 历史上 src/records.test.js 只对 SQL 做了直接断言，并且 parseFilterQuery 块完全
// 是测试中重新实现的 parseDateKey，未真正 import ./records。
// 下面这一组测试通过 mock ./database 注入内存库，对真实生产函数做断言。

jest.mock('./database', () => {
    const Database = require('better-sqlite3');
    const bcryptLocal = require('bcryptjs');
    const inMemDb = new Database(':memory:');
    inMemDb.exec(`
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
        CREATE INDEX idx_records_date ON records(date);
    `);
    const hashed = bcryptLocal.hashSync('test123', 10);
    inMemDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('shared_user', 'shared@test.com', hashed);
    return { getDb: () => inMemDb };
});

const { getDb } = require('./database');

let db;
let testUserId;

beforeAll(() => {
    db = getDb();
    const r = db.prepare('SELECT id FROM users WHERE username = ?').get('shared_user');
    testUserId = r.id;
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

// ============ 实际生产代码测试（直接 import ./records） ============

const {
    queryRecords,
    calculateStreak,
    computeStats,
    parseFilterQuery
} = require('./records');

describe('queryRecords - 实际生产代码', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    function insert(date, opts = {}) {
        db.prepare(`INSERT INTO records
            (user_id, date, poop_type, duration, status, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            testUserId,
            date,
            opts.poop_type ?? 4,
            opts.duration ?? 0,
            opts.status ?? null,
            opts.notes ?? null,
            opts.created_at ?? date
        );
    }

    test('应只返回指定用户且按时间倒序', () => {
        insert('2024-01-10T08:00:00', { created_at: '2024-01-10T08:00:00' });
        insert('2024-01-15T08:00:00', { created_at: '2024-01-15T08:00:00' });
        insert('2024-01-12T08:00:00', { created_at: '2024-01-12T08:00:00' });

        const out = queryRecords(testUserId);
        expect(out).toHaveLength(3);
        expect(out[0].poopType).toBe(4);
        // 第一条应是 15 号
        expect(out[0].date).toBe('2024-01-15T08:00:00');
    });

    test('不应返回其他用户的记录', () => {
        const otherId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
            .run('other_u', 'other@t.com', bcrypt.hashSync('p', 4)).lastInsertRowid;
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(otherId, '2024-01-15T08:00:00', 3, '2024-01-15T08:00:00');
        insert('2024-01-15T08:00:00');

        const out = queryRecords(testUserId);
        expect(out).toHaveLength(1);
        expect(out[0].userId).toBe(testUserId);
    });

    test('start 过滤应只返回该日期之后的记录', () => {
        insert('2024-01-10T08:00:00');
        insert('2024-01-15T08:00:00');
        insert('2024-01-20T08:00:00');

        const out = queryRecords(testUserId, { start: new Date(2024, 0, 15) });
        // 应包含 15 和 20，10 被过滤
        const dates = out.map(r => r.date);
        expect(dates).toContain('2024-01-15T08:00:00');
        expect(dates).toContain('2024-01-20T08:00:00');
        expect(dates).not.toContain('2024-01-10T08:00:00');
    });

    test('end 过滤使用 date() < 严格小于：end 当天的记录应被排除', () => {
        // 生产代码实现：date(r.date, 'localtime') < endKey 字符串
        // 即 end = 2024-01-15 时，15 日整天的记录都会被排除，仅返回 14 日及以前
        // 该行为由 parseFilterQuery 端通过 end.setHours(23,...) 提前补偿。
        insert('2024-01-10T08:00:00');
        insert('2024-01-15T08:00:00');
        insert('2024-01-20T08:00:00');

        const out = queryRecords(testUserId, { end: new Date(2024, 0, 15) });
        const dates = out.map(r => r.date);
        expect(dates).toContain('2024-01-10T08:00:00');
        expect(dates).not.toContain('2024-01-15T08:00:00');
        expect(dates).not.toContain('2024-01-20T08:00:00');
    });

    test('end 接受字符串时也应按日期严格小于过滤', () => {
        insert('2024-01-10T08:00:00');
        insert('2024-01-15T08:00:00');
        insert('2024-01-20T08:00:00');

        const out = queryRecords(testUserId, { end: '2024-01-15' });
        const dates = out.map(r => r.date);
        expect(dates).toContain('2024-01-10T08:00:00');
        expect(dates).not.toContain('2024-01-15T08:00:00');
        expect(dates).not.toContain('2024-01-20T08:00:00');
    });

    test('poopType 过滤应只返回匹配类型', () => {
        insert('2024-01-10T08:00:00', { poop_type: 3 });
        insert('2024-01-11T08:00:00', { poop_type: 4 });
        insert('2024-01-12T08:00:00', { poop_type: 4 });

        const out = queryRecords(testUserId, { poopType: 4 });
        expect(out.every(r => r.poopType === 4)).toBe(true);
        expect(out).toHaveLength(2);
    });

    test('返回的记录应通过 mapRecord 映射字段', () => {
        insert('2024-01-15T08:00:00', { duration: 300, notes: 'note-text' });
        const out = queryRecords(testUserId);
        expect(out[0]).toMatchObject({
            id: expect.any(Number),
            userId: testUserId,
            date: '2024-01-15T08:00:00',
            poopType: 4,
            duration: 300,
            notes: 'note-text'
        });
        expect(out[0].device).toBeDefined();
    });
});

describe('calculateStreak - 实际生产代码', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('仅今天有记录应返回 1', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(testUserId, today.toISOString(), 4, today.toISOString());
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('今天和昨天都有应返回 2', () => {
        const today = new Date(); today.setHours(10, 0, 0, 0);
        const yest = new Date(today); yest.setDate(today.getDate() - 1); yest.setHours(8, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(testUserId, today.toISOString(), 4, today.toISOString());
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(testUserId, yest.toISOString(), 4, yest.toISOString());
        expect(calculateStreak(testUserId)).toBe(2);
    });

    test('今天没有但昨天有应返回 0', () => {
        const yest = new Date(); yest.setDate(yest.getDate() - 1); yest.setHours(8, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
            .run(testUserId, yest.toISOString(), 4, yest.toISOString());
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('同一天多条记录应只计为 1 天（去重）', () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 5; i++) {
            const t = new Date(today); t.setHours(8 + i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
                .run(testUserId, t.toISOString(), 4, t.toISOString());
        }
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('连续 7 天打卡应返回 7', () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today); d.setDate(today.getDate() - i); d.setHours(8, 0, 0, 0);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
                .run(testUserId, d.toISOString(), 4, d.toISOString());
        }
        expect(calculateStreak(testUserId)).toBe(7);
    });

    test('中间中断应返回连续到中断处的天数', () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        // 今天、昨天、大前天（缺前天）
        for (const offset of [0, 1, 3]) {
            const d = new Date(today); d.setDate(today.getDate() - offset); d.setHours(8, 0, 0, 0);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)')
                .run(testUserId, d.toISOString(), 4, d.toISOString());
        }
        // 从今天开始：今天有(+1) -> 昨天有(+2) -> 前天无 -> 停止 = 2
        expect(calculateStreak(testUserId)).toBe(2);
    });
});

describe('computeStats - 实际生产代码', () => {
    test('空记录应返回默认值', () => {
        const s = computeStats([]);
        expect(s.total).toBe(0);
        expect(s.typeCounts).toEqual({});
        expect(s.avgDuration).toBe(0);
        expect(s.daily).toEqual([]);
        expect(s.weekly).toEqual([]);
    });

    test('应正确汇总类型计数', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 4, duration: 240 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-17T08:00:00', poopType: 5, duration: 120 }
        ];
        const s = computeStats(records);
        expect(s.total).toBe(4);
        expect(s.typeCounts[4]).toBe(2);
        expect(s.typeCounts[3]).toBe(1);
        expect(s.typeCounts[5]).toBe(1);
        expect(s.avgDuration).toBe(Math.round((300 + 240 + 600 + 120) / 4));
    });

    test('应按日期聚合（包含 avgDuration）', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T20:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-16T08:00:00', poopType: 4, duration: 200 }
        ];
        const s = computeStats(records);
        const d15 = s.daily.find(d => d.date === '2024-01-15');
        const d16 = s.daily.find(d => d.date === '2024-01-16');
        expect(d15.count).toBe(2);
        expect(d15.avgDuration).toBe(Math.round((300 + 600) / 2));
        expect(d16.count).toBe(1);
        expect(d16.avgDuration).toBe(200);
    });

    test('duration 为 0 或缺失的记录不应进入平均时长计算', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 0 },
            { date: '2024-01-15T20:00:00', poopType: 4, duration: 400 }
        ];
        const s = computeStats(records);
        // 仅 400 进入均值，期望 400
        expect(s.avgDuration).toBe(400);
    });

    test('应按周聚合', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 }, // 周一
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 200 }  // 周二
        ];
        const s = computeStats(records);
        expect(s.weekly.length).toBeGreaterThan(0);
        const totalWeekly = s.weekly.reduce((a, w) => a + w.count, 0);
        expect(totalWeekly).toBe(2);
    });

    test('poopType 为 0（falsy）应归入 typeCounts[0]', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 0, duration: 100 }
        ];
        const s = computeStats(records);
        expect(s.typeCounts[0]).toBe(1);
    });
});

describe('parseFilterQuery - 实际生产代码', () => {
    test('空查询应返回空对象', () => {
        expect(parseFilterQuery({})).toEqual({});
    });

    test('有效 start 应被解析为 Date', () => {
        const f = parseFilterQuery({ start: '2024-01-15' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.start.getFullYear()).toBe(2024);
        expect(f.start.getMonth()).toBe(0);
        expect(f.start.getDate()).toBe(15);
    });

    test('无效 start 应被忽略（不写入 filter）', () => {
        const f = parseFilterQuery({ start: 'not-a-date' });
        expect(f.start).toBeUndefined();
    });

    test('有效 end 应被解析为当天的 23:59:59.999', () => {
        const f = parseFilterQuery({ end: '2024-01-15' });
        expect(f.end).toBeInstanceOf(Date);
        expect(f.end.getFullYear()).toBe(2024);
        expect(f.end.getDate()).toBe(15);
        expect(f.end.getHours()).toBe(23);
        expect(f.end.getMinutes()).toBe(59);
        expect(f.end.getSeconds()).toBe(59);
    });

    test('无效 end 应被忽略', () => {
        const f = parseFilterQuery({ end: 'not-a-date' });
        expect(f.end).toBeUndefined();
    });

    test('合法范围内的 poop_type 应被解析为整数', () => {
        expect(parseFilterQuery({ poop_type: '4' }).poopType).toBe(4);
        expect(parseFilterQuery({ poop_type: '1' }).poopType).toBe(1);
        expect(parseFilterQuery({ poop_type: '7' }).poopType).toBe(7);
    });

    test('超出范围（<1 或 >7）的 poop_type 应被忽略', () => {
        expect(parseFilterQuery({ poop_type: '0' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: '8' }).poopType).toBeUndefined();
    });

    test('非数字 poop_type 应被忽略', () => {
        expect(parseFilterQuery({ poop_type: 'abc' }).poopType).toBeUndefined();
    });

    test('同时提供 start/end/poop_type 应一并解析', () => {
        const f = parseFilterQuery({ start: '2024-01-10', end: '2024-01-20', poop_type: '4' });
        expect(f.start).toBeInstanceOf(Date);
        expect(f.end).toBeInstanceOf(Date);
        expect(f.poopType).toBe(4);
    });
});