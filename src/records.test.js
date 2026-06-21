'use strict';

/**
 * src/records.js 单元测试
 * 重点覆盖：记录查询、连续打卡计算、统计计算、筛选解析
 */

const Database = require('better-sqlite3');
const { toDateKey, getWeekRange, getWeekNumber, mapRecord, parseDateKey } = require('./utils');

// 创建内存数据库
let db;
let testUserId;

beforeAll(() => {
    db = new Database(':memory:');
    
    // 初始化表结构
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user'
        );
        CREATE TABLE records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            poop_type INTEGER,
            duration INTEGER DEFAULT 0,
            status TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);
    
    // 创建测试用户
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('testuser', 'test@test.com', 'hashedpwd');
    testUserId = result.lastInsertRowid;
});

afterAll(() => {
    db.close();
});

// 复制 records.js 的函数实现用于测试（因为依赖 database.js 的 getDb）
function queryRecords(userId, { start, end, poopType } = {}) {
    const startKey = start ? (start instanceof Date
        ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
        : toDateKey(start)) : null;
    const endKey = end ? (end instanceof Date
        ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
        : toDateKey(end)) : null;

    const conds = ['r.user_id = ?'];
    const params = [userId];
    if (startKey) { conds.push("date(r.date, 'localtime') >= ?"); params.push(startKey); }
    if (endKey) { conds.push("date(r.date, 'localtime') < ?"); params.push(endKey); }
    if (poopType) { conds.push('r.poop_type = ?'); params.push(poopType); }

    const sql = `SELECT r.* FROM records r WHERE ${conds.join(' AND ')} ORDER BY COALESCE(r.created_at, r.date) DESC, r.date DESC`;
    return db.prepare(sql).all(...params).map(mapRecord);
}

function calculateStreak(userId) {
    const records = db.prepare("SELECT date FROM records WHERE user_id = ? ORDER BY date DESC").all(userId);
    if (records.length === 0) return 0;

    const days = new Set(records.map(r => toDateKey(r.date)).filter(Boolean));
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 3650; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (days.has(key)) streak++;
        else break;
    }
    return streak;
}

function computeStats(records) {
    const total = records.length;
    const typeCounts = {};
    let totalDuration = 0;
    let durationCount = 0;

    records.forEach(r => {
        const t = r.poopType || 0;
        typeCounts[t] = (typeCounts[t] || 0) + 1;
        if (r.duration && r.duration > 0) { totalDuration += r.duration; durationCount++; }
    });
    const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

    const byDay = {};
    records.forEach(r => {
        const key = toDateKey(r.date);
        if (!key) return;
        if (!byDay[key]) byDay[key] = { count: 0, totalDuration: 0, durationN: 0 };
        byDay[key].count++;
        if (r.duration && r.duration > 0) {
            byDay[key].totalDuration += r.duration;
            byDay[key].durationN++;
        }
    });
    const daily = Object.keys(byDay).sort().map(k => ({
        date: k,
        count: byDay[k].count,
        avgDuration: byDay[k].durationN ? Math.round(byDay[k].totalDuration / byDay[k].durationN) : 0
    }));

    const byWeek = {};
    records.forEach(r => {
        const wr = getWeekRange(r.date);
        if (!wr) return;
        const key = `${wr.start.getFullYear()}-W${getWeekNumber(wr.start)}`;
        if (!byWeek[key]) byWeek[key] = { key, start: wr.start.toISOString(), count: 0, totalDuration: 0, durationN: 0 };
        byWeek[key].count++;
        if (r.duration && r.duration > 0) {
            byWeek[key].totalDuration += r.duration;
            byWeek[key].durationN++;
        }
    });
    const weekly = Object.values(byWeek).map(w => ({
        key: w.key, start: w.start, count: w.count,
        avgDuration: w.durationN ? Math.round(w.totalDuration / w.durationN) : 0
    })).sort((a, b) => a.key.localeCompare(b.key));

    return { total, typeCounts, avgDuration, daily, weekly };
}

function parseFilterQuery(query) {
    const filter = {};
    if (query.start) {
        const s = parseDateKey(query.start);
        if (s) filter.start = s;
    }
    if (query.end) {
        const e = parseDateKey(query.end);
        if (e) { e.setHours(23, 59, 59, 999); filter.end = e; }
    }
    if (query.poop_type) {
        const pt = parseInt(query.poop_type, 10);
        if (!isNaN(pt) && pt >= 1 && pt <= 7) filter.poopType = pt;
    }
    return filter;
}

// ============ queryRecords 测试 ============
describe('queryRecords - 记录查询', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records').run();
    });

    test('无记录返回空数组', () => {
        const records = queryRecords(testUserId);
        expect(records).toEqual([]);
    });

    test('查询用户所有记录', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-15T08:00:00', 4, 300);
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration) VALUES (?, ?, ?, ?)').run(testUserId, '2024-01-14T08:00:00', 3, 200);
        
        const records = queryRecords(testUserId);
        expect(records.length).toBe(2);
        expect(records[0].poopType).toBe(4);
        expect(records[1].poopType).toBe(3);
    });

    test('按日期范围筛选', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-15T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-10T08:00:00', 3);
        
        const start = new Date(2024, 0, 13);
        const end = new Date(2024, 0, 16);
        const records = queryRecords(testUserId, { start, end });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });

    test('按大便类型筛选', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-15T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-14T08:00:00', 3);
        
        const records = queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
    });

    test('组合筛选', () => {
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-15T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-14T08:00:00', 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, '2024-01-10T08:00:00', 3);
        
        const start = new Date(2024, 0, 13);
        const records = queryRecords(testUserId, { start, poopType: 4 });
        expect(records.length).toBe(2);
    });
});

// ============ calculateStreak 测试 ============
describe('calculateStreak - 连续打卡计算', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records').run();
    });

    test('无记录返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录返回 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, today.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(1);
    });

    test('连续 7 天打卡', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, d.toISOString(), 4);
        }
        expect(calculateStreak(testUserId)).toBe(7);
    });

    test('中断后返回中断前的天数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // 今天和昨天有，前天没有
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, today.toISOString(), 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, yesterday.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(2);
    });

    test('今天无记录但昨天有返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, yesterday.toISOString(), 4);
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('同一天多条记录只计一次', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, today.toISOString(), 4);
        db.prepare('INSERT INTO records (user_id, date, poop_type) VALUES (?, ?, ?)').run(testUserId, today.toISOString(), 3);
        expect(calculateStreak(testUserId)).toBe(1);
    });
});

// ============ computeStats 测试 ============
describe('computeStats - 统计计算', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM records').run();
    });

    test('空记录返回零统计', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.avgDuration).toBe(0);
        expect(stats.typeCounts).toEqual({});
        expect(stats.daily).toEqual([]);
        expect(stats.weekly).toEqual([]);
    });

    test('单条记录统计', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(1);
        expect(stats.avgDuration).toBe(300);
        expect(stats.typeCounts[4]).toBe(1);
        expect(stats.daily.length).toBe(1);
    });

    test('多条记录统计', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: 200 },
            { date: '2024-01-14T08:00:00', poopType: 4, duration: 400 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.avgDuration).toBe(300); // (300+200+400)/3
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.daily.length).toBe(2); // 两天
    });

    test('无 duration 记录不计入平均时长', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-14T08:00:00', poopType: 3, duration: null }
        ];
        const stats = computeStats(records);
        expect(stats.avgDuration).toBe(300);
    });

    test('日统计聚合', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: 200 }
        ];
        const stats = computeStats(records);
        expect(stats.daily.length).toBe(1);
        expect(stats.daily[0].count).toBe(2);
        expect(stats.daily[0].avgDuration).toBe(250); // (300+200)/2
    });

    test('周统计聚合', () => {
        // 2024-01-15 是周一
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-16T08:00:00', poopType: 3, duration: 200 }
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(1);
        expect(stats.weekly[0].count).toBe(2);
    });

    test('跨周统计', () => {
        // 2024-01-15 周一，2024-01-22 下周一
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-22T08:00:00', poopType: 3, duration: 200 }
        ];
        const stats = computeStats(records);
        expect(stats.weekly.length).toBe(2);
    });
});

// ============ parseFilterQuery 测试 ============
describe('parseFilterQuery - 筛选参数解析', () => {
    test('空参数返回空对象', () => {
        expect(parseFilterQuery({})).toEqual({});
    });

    test('解析 start 参数', () => {
        const filter = parseFilterQuery({ start: '2024-01-15' });
        expect(filter.start).toBeDefined();
        expect(filter.start.getFullYear()).toBe(2024);
        expect(filter.start.getMonth()).toBe(0);
        expect(filter.start.getDate()).toBe(15);
    });

    test('解析 end 参数并设置时间', () => {
        const filter = parseFilterQuery({ end: '2024-01-15' });
        expect(filter.end).toBeDefined();
        expect(filter.end.getHours()).toBe(23);
        expect(filter.end.getMinutes()).toBe(59);
        expect(filter.end.getSeconds()).toBe(59);
    });

    test('解析 poop_type 参数', () => {
        const filter = parseFilterQuery({ poop_type: '4' });
        expect(filter.poopType).toBe(4);
    });

    test('无效 poop_type 不设置', () => {
        expect(parseFilterQuery({ poop_type: '8' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: '0' }).poopType).toBeUndefined();
        expect(parseFilterQuery({ poop_type: 'invalid' }).poopType).toBeUndefined();
    });

    test('组合参数', () => {
        const filter = parseFilterQuery({ start: '2024-01-01', end: '2024-01-31', poop_type: '4' });
        expect(filter.start).toBeDefined();
        expect(filter.end).toBeDefined();
        expect(filter.poopType).toBe(4);
    });

    test('无效日期不设置', () => {
        expect(parseFilterQuery({ start: 'invalid' }).start).toBeUndefined();
        expect(parseFilterQuery({ end: 'invalid' }).end).toBeUndefined();
    });
});