process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

// 共享内存数据库：路由层、中间件层、records 层都用同一份
let mockDb;
jest.mock('../database', () => ({
    getDb: () => mockDb,
    addLoginLog: () => {},
    addAuditLog: () => {}
}));

// 引入真实的路由
const recordsRouter = require('./records');

let app;
let testUserId;
let testToken;

beforeAll(() => {
    mockDb = new Database(':memory:');
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
        CREATE INDEX idx_records_date ON records(date);
    `);

    const r = mockDb.prepare(
        'INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?, ?, ?, ?, ?)'
    ).run('alice', 'alice@test.com', 'hash', 'user', new Date('2024-01-01').toISOString());
    testUserId = r.lastInsertRowid;
    // iat 远晚于 password_changed_at → 认证中间件不会拒绝
    testToken = jwt.sign(
        { userId: testUserId, username: 'alice', role: 'user' },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );

    app = express();
    app.use(express.json());
    app.use('/api/record', recordsRouter);
});

afterAll(() => {
    mockDb.close();
});

function authed(req) {
    return req.set('Authorization', `Bearer ${testToken}`);
}

// 辅助：在指定日期插入一条测试记录
function insertRecord(dateISO, poopType, duration = 0, notes = null) {
    const r = mockDb.prepare(`INSERT INTO records (user_id, date, poop_type, duration, notes, created_at)
                              VALUES (?, ?, ?, ?, ?, ?)`).run(testUserId, dateISO, poopType, duration, notes, dateISO);
    return r.lastInsertRowid;
}

// ============ XSS 转义：记录创建与更新（业务关键安全特性） ============
describe('记录路由 - XSS 转义', () => {
    test('创建记录时 notes 中的 HTML 标签应被转义', async () => {
        const res = await authed(request(app).post('/api/record'))
            .send({ poop_type: 4, notes: '<script>alert("xss")</script>' });
        expect(res.status).toBe(200);
        expect(res.body.record.notes).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        // 数据库存储也应是转义后的内容
        const row = mockDb.prepare('SELECT notes FROM records WHERE id = ?').get(res.body.record.id);
        expect(row.notes).not.toContain('<script>');
    });

    test('创建记录时 status 中的特殊字符应被转义', async () => {
        const res = await authed(request(app).post('/api/record'))
            .send({ poop_type: 4, status: 'A&B<C>"x"' });
        expect(res.status).toBe(200);
        expect(res.body.record.status).toBe('A&amp;B&lt;C&gt;&quot;x&quot;');
    });

    test('更新记录时 notes 应被转义', async () => {
        const id = insertRecord('2024-01-15T10:00:00', 4, 0, '原始备注');
        const res = await authed(request(app).put(`/api/record/${id}`))
            .send({ notes: '<img src=x onerror=alert(1)>' });
        expect(res.status).toBe(200);
        expect(res.body.record.notes).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('长 notes 应被截断到 500 字符', async () => {
        const longNotes = 'a'.repeat(800);
        const res = await authed(request(app).post('/api/record'))
            .send({ poop_type: 4, notes: longNotes });
        expect(res.status).toBe(200);
        expect(res.body.record.notes.length).toBe(500);
    });
});

// ============ 记录创建校验（边界条件） ============
describe('记录路由 - 数据校验', () => {
    test('日期晚于今天应返回 400', async () => {
        const future = new Date();
        future.setDate(future.getDate() + 5);
        const res = await authed(request(app).post('/api/record'))
            .send({ poop_type: 4, date: future.toISOString() });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('日期不能晚于今天');
    });

    test('日期等于今天应允许（endOfToday 边界）', async () => {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const res = await authed(request(app).post('/api/record'))
            .send({ poop_type: 4, date: today.toISOString() });
        expect(res.status).toBe(200);
    });

    test('无效 date 字符串应返回 400', async () => {
        const res = await authed(request(app).post('/api/record'))
            .send({ poop_type: 4, date: 'totally-invalid' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('日期格式无效');
    });
});

// ============ 历史记录 ============
describe('GET /history', () => {
    test('应返回当前用户的所有记录', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        insertRecord('2024-01-14T10:00:00', 3);
        insertRecord('2024-01-15T10:00:00', 4);
        const res = await authed(request(app).get('/api/record/history'));
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(2);
    });

    test('未认证应返回 401', async () => {
        const res = await request(app).get('/api/record/history');
        expect(res.status).toBe(401);
    });
});

// ============ 周视图 ============
describe('GET /weekly - 周视图', () => {
    test('应返回 7 天的数据，每日 0 填充', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        insertRecord(new Date().toISOString(), 4, 300);
        const res = await authed(request(app).get('/api/record/weekly'));
        expect(res.status).toBe(200);
        expect(res.body.days.length).toBe(7);
        expect(res.body.range).toBeDefined();
        expect(res.body.weekLabel).toBeDefined();
        expect(res.body.summary).toBeDefined();
        expect(res.body.summary.totalCount).toBe(1);
    });

    test('空数据应返回 0 而非 NaN', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        const res = await authed(request(app).get('/api/record/weekly'));
        expect(res.status).toBe(200);
        expect(res.body.summary.totalCount).toBe(0);
        expect(res.body.summary.avgDuration).toBe(0);
        expect(res.body.summary.avgPerDay).toBe(0);
        for (const d of res.body.days) {
            expect(d.count).toBe(0);
            expect(d.avgDuration).toBe(0);
        }
    });

    test('指定 date 参数应定位到对应的那一周', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        // 2024-01-15 是周一
        const target = '2024-01-15';
        const res = await authed(request(app).get(`/api/record/weekly?date=${target}`));
        expect(res.status).toBe(200);
        // 起始日期应为 2024-01-15 周一
        const start = new Date(res.body.range.start);
        expect(start.getDate()).toBe(15);
        expect(start.getMonth()).toBe(0);
    });

    test('poop_type 过滤应仅返回该类型记录', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        insertRecord(new Date().toISOString(), 4);
        insertRecord(new Date().toISOString(), 5);
        const res = await authed(request(app).get('/api/record/weekly?poop_type=4'));
        expect(res.status).toBe(200);
        expect(res.body.records.every(r => r.poopType === 4)).toBe(true);
    });
});

// ============ 月视图 ============
describe('GET /monthly - 月视图', () => {
    test('应返回指定月的全部天数', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        const res = await authed(request(app).get('/api/record/monthly?date=2024-01'));
        expect(res.status).toBe(200);
        // 1 月有 31 天
        expect(res.body.days.length).toBe(31);
        expect(res.body.month).toBe('2024-01');
        expect(res.body.weeks.length).toBeGreaterThan(0);
    });

    test('应包含与上一个月的对比数据', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        insertRecord('2024-01-15T10:00:00', 4);
        const res = await authed(request(app).get('/api/record/monthly?date=2024-02'));
        expect(res.status).toBe(200);
        expect(res.body.compareWithLastMonth).toBeDefined();
        expect(res.body.compareWithLastMonth.count).toBeGreaterThanOrEqual(0);
    });

    test('非法 date 格式应回退到当前月（不报错）', async () => {
        const res = await authed(request(app).get('/api/record/monthly?date=invalid'));
        expect(res.status).toBe(200);
        // 回退到当前月，days 长度应为 28~31 之间
        expect(res.body.days.length).toBeGreaterThanOrEqual(28);
    });

    test('compareWithLastMonth.diff 在 0 记录时为 0（避免除零）', async () => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        // 上月也没有记录
        const res = await authed(request(app).get('/api/record/monthly?date=2024-01'));
        expect(res.status).toBe(200);
        expect(res.body.compareWithLastMonth.diff).toBe(0);
    });
});

// ============ 列表/筛选 ============
describe('GET /list - 筛选列表', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('start + end 区间应正确收窄（half-open 区间，end 当天不包含）', async () => {
        insertRecord('2024-01-14T10:00:00', 3);
        insertRecord('2024-01-15T10:00:00', 4);
        insertRecord('2024-01-16T10:00:00', 5);
        // [2024-01-15, 2024-01-16) → 仅 2024-01-15 被命中
        const res = await authed(request(app).get('/api/record/list?start=2024-01-15&end=2024-01-16'));
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].poopType).toBe(4);
        expect(res.body.stats).toBeDefined();
        expect(res.body.stats.total).toBe(1);
    });

    test('无效的过滤参数应被忽略，不报错', async () => {
        const res = await authed(request(app).get('/api/record/list?start=garbage&end=garbage&poop_type=99'));
        expect(res.status).toBe(200);
        expect(res.body.records).toEqual([]);
    });
});

// ============ 导出 ============
describe('GET /export - 导出', () => {
    beforeEach(() => {
        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('CSV 导出应返回 text/csv 和正确文件名', async () => {
        insertRecord('2024-01-15T08:30:00', 4, 300, '正常');
        const res = await authed(request(app).get('/api/record/export?format=csv'));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.headers['content-disposition']).toMatch(/attachment.*\.csv/);
        // CSV 首行应为表头
        const firstLine = res.text.split('\r\n')[0];
        expect(firstLine).toContain('日期');
        expect(firstLine).toContain('类型编号');
    });

    test('TXT 导出应返回 text/plain 和正确文件名', async () => {
        // 使用今日日期，确保落在默认 month 区间内
        insertRecord(new Date().toISOString(), 4, 300, '正常');
        const res = await authed(request(app).get('/api/record/export?format=txt'));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toContain('拉屎记录');
        expect(res.text).toContain('共 1 条记录');
    });

    test('range=week 导出应仅含本周数据', async () => {
        // 插入 30 天前和今天的两条
        const old = new Date(); old.setDate(old.getDate() - 30);
        insertRecord(old.toISOString(), 4);
        insertRecord(new Date().toISOString(), 4);
        const res = await authed(request(app).get('/api/record/export?format=txt&range=week'));
        expect(res.status).toBe(200);
        expect(res.text).toContain('共 1 条记录');
    });

    test('range=all 导出应包含所有记录', async () => {
        insertRecord('2023-01-01T10:00:00', 4);
        insertRecord(new Date().toISOString(), 4);
        const res = await authed(request(app).get('/api/record/export?format=csv&range=all'));
        expect(res.status).toBe(200);
        // 至少包含 3 行：表头 + 2 条记录
        const lines = res.text.split('\r\n').filter(Boolean);
        expect(lines.length).toBe(3);
    });

    test('导出文件名应包含日期段标识', async () => {
        const res = await authed(request(app).get('/api/record/export?format=csv&range=month'));
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toMatch(/monthly_\d{6}\.csv/);
    });
});
