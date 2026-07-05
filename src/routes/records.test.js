process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');

let mockDb;
let testUserId;
let testToken;
let app;

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

    testToken = jwt.sign(
        { userId: testUserId, username: 'testuser', role: 'user', iat: Math.floor(Date.now() / 1000) },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/records', require('./records'));
});

afterAll(() => {
    mockDb.close();
});

beforeEach(() => {
    mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
});

describe('POST /records - 新增记录', () => {
    test('有效数据应创建记录', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, notes: 'test note', duration: 300 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.record.poopType).toBe(4);
        expect(res.body.record.notes).toBe('test note');
        expect(res.body.record.duration).toBe(300);
    });

    test('缺少 poop_type 应返回 400', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ notes: 'no type' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('大便类型');
    });

    test('无效 poop_type 应返回 400', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 0 });

        expect(res.status).toBe(400);
    });

    test('poop_type > 7 应返回 400', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 8 });

        expect(res.status).toBe(400);
    });

    test('未登录应返回 401', async () => {
        const res = await request(app)
            .post('/records')
            .send({ poop_type: 4 });

        expect(res.status).toBe(401);
    });

    test('未来日期应返回 400', async () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        const futureDateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, date: futureDateStr });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能晚于今天');
    });

    test('无效 duration 应默认为 0', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, duration: -1 });

        expect(res.status).toBe(200);
        expect(res.body.record.duration).toBe(0);
    });

    test('超长 duration 应默认为 0', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, duration: 999999 });

        expect(res.status).toBe(200);
        expect(res.body.record.duration).toBe(0);
    });

    test('备注应被转义防止 XSS', async () => {
        const res = await request(app)
            .post('/records')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, notes: '<script>alert(1)</script>' });

        expect(res.status).toBe(200);
        expect(res.body.record.notes).not.toContain('<script>');
    });
});

describe('GET /records/history - 历史记录', () => {
    test('应返回用户的所有记录', async () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-14T10:00:00', 3, '2024-01-14T10:00:00'
        );

        const res = await request(app)
            .get('/records/history')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(2);
    });

    test('未登录应返回 401', async () => {
        const res = await request(app)
            .get('/records/history');

        expect(res.status).toBe(401);
    });
});

describe('GET /records/home - 首页数据', () => {
    test('应返回 streak、最近记录和近7天统计', async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }

        const res = await request(app)
            .get('/records/home')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.streak).toBe(3);
        expect(res.body.records.length).toBeGreaterThan(0);
        expect(res.body.last7.count).toBeGreaterThan(0);
    });
});

describe('GET /records/list - 筛选列表', () => {
    test('无筛选应返回所有记录和统计', async () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, '2024-01-15T08:30:00'
        );

        const res = await request(app)
            .get('/records/list')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.stats).toBeDefined();
        expect(res.body.stats.total).toBe(1);
    });

    test('按类型筛选', async () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-16T08:30:00', 3, '2024-01-16T08:30:00'
        );

        const res = await request(app)
            .get('/records/list?poop_type=4')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].poopType).toBe(4);
    });

    test('按日期范围筛选', async () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );

        const res = await request(app)
            .get('/records/list?start=2024-01-01&end=2024-01-31')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
    });
});

describe('PUT /records/:id - 更新记录', () => {
    test('应更新记录字段', async () => {
        const insertResult = mockDb.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, 'original', '2024-01-15T08:30:00'
        );
        const recordId = insertResult.lastInsertRowid;

        const res = await request(app)
            .put(`/records/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 3, notes: 'updated', duration: 400 });

        expect(res.status).toBe(200);
        expect(res.body.record.poopType).toBe(3);
        expect(res.body.record.notes).toBe('updated');
        expect(res.body.record.duration).toBe(400);
    });

    test('不存在的记录应返回 404', async () => {
        const res = await request(app)
            .put('/records/99999')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 3 });

        expect(res.status).toBe(404);
    });

    test('无效 poop_type 应返回 400', async () => {
        const insertResult = mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        const recordId = insertResult.lastInsertRowid;

        const res = await request(app)
            .put(`/records/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 0 });

        expect(res.status).toBe(400);
    });
});

describe('DELETE /records/:id - 删除记录', () => {
    test('应删除记录', async () => {
        const insertResult = mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        const recordId = insertResult.lastInsertRowid;

        const res = await request(app)
            .delete(`/records/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('不存在的记录应返回 404', async () => {
        const res = await request(app)
            .delete('/records/99999')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(404);
    });

    test('其他用户的记录应返回 403', async () => {
        const otherUserId = mockDb.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other2', 'other2@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        const insertResult = mockDb.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
        );
        const recordId = insertResult.lastInsertRowid;

        const res = await request(app)
            .delete(`/records/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(403);

        mockDb.prepare('DELETE FROM records WHERE user_id = ?').run(otherUserId);
        mockDb.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });
});

describe('GET /records/weekly - 周视图', () => {
    test('应返回周视图数据', async () => {
        const today = new Date();
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, new Date().toISOString()
        );

        const res = await request(app)
            .get('/records/weekly')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.days.length).toBe(7);
        expect(res.body.summary).toBeDefined();
    });

    test('应支持指定日期', async () => {
        const res = await request(app)
            .get('/records/weekly?date=2024-01-15')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.days.length).toBe(7);
    });
});

describe('GET /records/monthly - 月视图', () => {
    test('应返回月视图数据', async () => {
        const res = await request(app)
            .get('/records/monthly')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.days).toBeDefined();
        expect(res.body.weeks).toBeDefined();
        expect(res.body.summary).toBeDefined();
    });

    test('应支持指定月份', async () => {
        const res = await request(app)
            .get('/records/monthly?date=2024-01')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.month).toBe('2024-01');
    });
});

describe('GET /records/export - 导出', () => {
    test('CSV 导出应返回正确的 Content-Type', async () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, 'test', '2024-01-15T08:30:00'
        );

        const res = await request(app)
            .get('/records/export?format=csv&range=all')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('.csv');
    });

    test('TXT 导出应返回正确的 Content-Type', async () => {
        mockDb.prepare('INSERT INTO records (user_id, date, poop_type, duration, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            testUserId, '2024-01-15T08:30:00', 4, 300, 'test', '2024-01-15T08:30:00'
        );

        const res = await request(app)
            .get('/records/export?format=txt&range=all')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.headers['content-disposition']).toContain('.txt');
    });

    test('周范围导出', async () => {
        const res = await request(app)
            .get('/records/export?format=csv&range=week')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('weekly');
    });

    test('月范围导出', async () => {
        const res = await request(app)
            .get('/records/export?format=csv&range=month')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('monthly');
    });
});
