const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { createApp } = require('./index');

const TEST_DB_PATH = ':memory:';
const JWT_SECRET = 'test-secret-key';

let app;
let db;
let testUserId;
let adminUserId;
let testToken;
let adminToken;

let toDateKey;
let parseDateKey;
let calculateStreak;
let getWeekRange;
let daysBetween;
let getWeekNumber;
let queryRecords;
let computeStats;
let parseFilterQuery;
let extractDeviceInfo;
let mapRecord;
let formatDurationSec;

beforeAll(() => {
    const appInstance = createApp(TEST_DB_PATH, JWT_SECRET);
    app = appInstance.app;
    db = appInstance.db;
    toDateKey = appInstance.toDateKey;
    parseDateKey = appInstance.parseDateKey;
    calculateStreak = appInstance.calculateStreak;
    getWeekRange = appInstance.getWeekRange;
    daysBetween = appInstance.daysBetween;
    getWeekNumber = appInstance.getWeekNumber;
    queryRecords = appInstance.queryRecords;
    computeStats = appInstance.computeStats;
    parseFilterQuery = appInstance.parseFilterQuery;
    extractDeviceInfo = appInstance.extractDeviceInfo;
    mapRecord = appInstance.mapRecord;
    formatDurationSec = appInstance.formatDurationSec;

    const hashedPassword = bcrypt.hashSync('test123', 10);
    const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', hashedPassword, 'user');
    testUserId = result.lastInsertRowid;
    testToken = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

    const adminPassword = bcrypt.hashSync('admin123', 10);
    const adminResult = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@test.com', adminPassword, 'admin');
    adminUserId = adminResult.lastInsertRowid;
    adminToken = jwt.sign({ userId: adminUserId, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });
});

afterAll(() => {
    db.close();
});

describe('toDateKey - 日期解析与时区处理', () => {
    test('纯日期格式 YYYY-MM-DD 应正确解析', () => {
        expect(toDateKey('2024-01-15')).toBe('2024-01-15');
        expect(toDateKey('2024-12-31')).toBe('2024-12-31');
    });

    test('带时间的 ISO 字符串（无时区）应取本地日期', () => {
        expect(toDateKey('2024-01-15T08:30:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
    });

    test('带 Z 时区的 UTC 时间应转换为本地日期', () => {
        const result = toDateKey('2024-01-15T00:00:00Z');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('带时区偏移的 ISO 字符串应正确转换', () => {
        expect(toDateKey('2024-01-15T08:00:00+08:00')).toBe('2024-01-15');
        expect(toDateKey('2024-01-15T00:00:00-08:00')).toBe('2024-01-15');
    });

    test('空值和无效输入应返回 null', () => {
        expect(toDateKey(null)).toBeNull();
        expect(toDateKey(undefined)).toBeNull();
        expect(toDateKey('')).toBeNull();
        expect(toDateKey('invalid')).toBeNull();
    });

    test('边界情况：跨日期的时间点', () => {
        expect(toDateKey('2024-01-15T23:59:59')).toBe('2024-01-15');
        expect(toDateKey('2024-01-16T00:00:00')).toBe('2024-01-16');
    });
});

describe('parseDateKey - 完整日期解析', () => {
    test('纯日期应解析为本地 00:00:00', () => {
        const d = parseDateKey('2024-01-15');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    test('带时间的 ISO 字符串应正确解析', () => {
        const d = parseDateKey('2024-01-15T14:30:00');
        expect(d).not.toBeNull();
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(30);
    });

    test('带 Z 时区应转换为本地时间', () => {
        const d = parseDateKey('2024-01-15T08:00:00Z');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('带时区偏移应正确转换', () => {
        const d = parseDateKey('2024-01-15T08:00:00+08:00');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
    });

    test('无效日期应返回 null', () => {
        expect(parseDateKey(null)).toBeNull();
        expect(parseDateKey('invalid')).toBeNull();
    });
});

describe('calculateStreak - 连续打卡天数', () => {
    test('无记录时应返回 0', () => {
        expect(calculateStreak(testUserId)).toBe(0);
    });

    test('今天有记录时应返回 1', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(1);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('连续 7 天打卡应返回 7', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }
        expect(calculateStreak(testUserId)).toBe(7);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('中断打卡应返回中断前的天数', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(2);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('今天无记录但昨天有应返回 0', () => {
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 4, new Date().toISOString()
        );
        expect(calculateStreak(testUserId)).toBe(0);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

describe('getWeekRange - 周范围计算', () => {
    test('应返回周一和下周一', () => {
        const date = new Date(2024, 0, 17);
        const range = getWeekRange(date);
        expect(range).not.toBeNull();
        expect(range.start.getDay()).toBe(1);
        expect(range.end.getDay()).toBe(1);
        expect(range.end.getTime() - range.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    test('周日应正确计算到下周一', () => {
        const date = new Date(2024, 0, 21);
        const range = getWeekRange(date);
        expect(range.start.getDay()).toBe(1);
    });

    test('无效日期应返回 null', () => {
        expect(getWeekRange('invalid')).toBeNull();
    });
});

describe('daysBetween - 日期范围生成', () => {
    test('应生成正确数量的日期', () => {
        const start = new Date(2024, 0, 1);
        const end = new Date(2024, 0, 5);
        const days = daysBetween(start, end);
        expect(days.length).toBe(4);
    });

    test('开始日期应包含在内', () => {
        const start = new Date(2024, 0, 1);
        const end = new Date(2024, 0, 3);
        const days = daysBetween(start, end);
        expect(days[0].getDate()).toBe(1);
    });

    test('结束日期不应包含在内', () => {
        const start = new Date(2024, 0, 1);
        const end = new Date(2024, 0, 3);
        const days = daysBetween(start, end);
        expect(days.some(d => d.getDate() === 3)).toBe(false);
    });
});

describe('getWeekNumber - ISO 周数', () => {
    test('应正确计算周数', () => {
        const date = new Date(2024, 0, 15);
        const weekNum = getWeekNumber(date);
        expect(weekNum).toBeGreaterThan(0);
        expect(weekNum).toBeLessThanOrEqual(53);
    });

    test('年初应正确计算', () => {
        const date = new Date(2024, 0, 1);
        const weekNum = getWeekNumber(date);
        expect(weekNum).toBeGreaterThan(0);
    });
});

describe('queryRecords - 记录查询', () => {
    test('应返回用户的记录', () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        const records = queryRecords(testUserId);
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应支持日期范围筛选', () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, yesterday.toISOString(), 3, new Date().toISOString()
        );
        const records = queryRecords(testUserId, { start: today });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('应支持类型筛选', () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 3, new Date().toISOString()
        );
        const records = queryRecords(testUserId, { poopType: 4 });
        expect(records.length).toBe(1);
        expect(records[0].poopType).toBe(4);
        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

describe('computeStats - 统计计算', () => {
    test('应计算正确的统计信息', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 3, duration: 600 },
            { date: '2024-01-14T08:00:00', poopType: 4, duration: 120 }
        ];
        const stats = computeStats(records);
        expect(stats.total).toBe(3);
        expect(stats.typeCounts[4]).toBe(2);
        expect(stats.typeCounts[3]).toBe(1);
        expect(stats.avgDuration).toBe(340);
        expect(stats.daily.length).toBe(2);
        expect(stats.weekly.length).toBeGreaterThan(0);
    });

    test('空记录应返回零值统计', () => {
        const stats = computeStats([]);
        expect(stats.total).toBe(0);
        expect(stats.avgDuration).toBe(0);
        expect(stats.daily.length).toBe(0);
        expect(stats.weekly.length).toBe(0);
    });
});

describe('parseFilterQuery - 筛选参数解析', () => {
    test('应正确解析日期范围', () => {
        const query = { start: '2024-01-01', end: '2024-01-31' };
        const filter = parseFilterQuery(query);
        expect(filter.start).toBeInstanceOf(Date);
        expect(filter.end).toBeInstanceOf(Date);
        expect(filter.end.getHours()).toBe(23);
    });

    test('应正确解析类型筛选', () => {
        const query = { poop_type: '4' };
        const filter = parseFilterQuery(query);
        expect(filter.poopType).toBe(4);
    });

    test('无效类型应被忽略', () => {
        const query = { poop_type: '8' };
        const filter = parseFilterQuery(query);
        expect(filter.poopType).toBeUndefined();
    });

    test('空查询应返回空对象', () => {
        const filter = parseFilterQuery({});
        expect(Object.keys(filter).length).toBe(0);
    });
});

describe('extractDeviceInfo - 设备信息提取', () => {
    test('应正确识别桌面 Chrome', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('Chrome');
        expect(info.os).toBe('Windows 10/11');
        expect(info.model).toBe('Windows PC');
        expect(info.ip).toBe('127.0.0.1');
    });

    test('应正确识别移动设备', () => {
        const req = {
            headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
            connection: { remoteAddress: '192.168.1.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('移动设备');
        expect(info.browser).toBe('Safari');
        expect(info.os).toBe('iOS');
        expect(info.model).toBe('iPhone');
    });

    test('应正确识别未知设备', () => {
        const req = {
            headers: {},
            connection: { remoteAddress: '127.0.0.1' }
        };
        const info = extractDeviceInfo(req);
        expect(info.type).toBe('桌面电脑');
        expect(info.browser).toBe('未知浏览器');
        expect(info.os).toBe('未知系统');
    });
});

describe('formatDurationSec - 时长格式化', () => {
    test('零或负数应返回 "0 秒"', () => {
        expect(formatDurationSec(0)).toBe('0 秒');
        expect(formatDurationSec(-1)).toBe('0 秒');
        expect(formatDurationSec(null)).toBe('0 秒');
    });

    test('小于 60 秒应返回秒数', () => {
        expect(formatDurationSec(30)).toBe('30 秒');
        expect(formatDurationSec(59)).toBe('59 秒');
    });

    test('正好 60 秒应返回 "1 分"', () => {
        expect(formatDurationSec(60)).toBe('1 分');
    });

    test('超过 60 秒应返回分秒组合', () => {
        expect(formatDurationSec(90)).toBe('1 分 30 秒');
        expect(formatDurationSec(120)).toBe('2 分');
    });
});

describe('认证 API', () => {
    test('注册：缺少必填字段应返回 400', async () => {
        const res = await request(app).post('/api/register').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能为空');
    });

    test('注册：正常注册应成功', async () => {
        const res = await request(app).post('/api/register').send({
            username: 'newuser',
            email: 'new@test.com',
            password: 'password123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
    });

    test('注册：重复邮箱应返回 400', async () => {
        const res = await request(app).post('/api/register').send({
            username: 'another',
            email: 'test@test.com',
            password: 'password123'
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('已被注册');
    });

    test('登录：缺少字段应返回 400', async () => {
        const res = await request(app).post('/api/login').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('请输入');
    });

    test('登录：错误密码应返回 401', async () => {
        const res = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'wrongpassword'
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toContain('账号或密码错误');
    });

    test('登录：正确凭据应成功', async () => {
        const res = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'test123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
    });

    test('登录：支持用户名登录', async () => {
        const res = await request(app).post('/api/login').send({
            email: 'testuser',
            password: 'test123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('认证中间件', () => {
    test('无 token 应返回 401', async () => {
        const res = await request(app).get('/api/user');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    test('无效 token 应返回 403', async () => {
        const res = await request(app).get('/api/user').set('Authorization', 'Bearer invalidtoken');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Invalid token');
    });

    test('有效 token 应成功获取用户信息', async () => {
        const res = await request(app).get('/api/user').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('testuser');
        expect(res.body.email).toBe('test@test.com');
    });
});

describe('记录 API - 数据校验', () => {
    test('创建记录：缺少大便类型应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('请先选择大便类型');
    });

    test('创建记录：无效类型值应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 8 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('1-7型');
    });

    test('创建记录：正常创建应成功', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, duration: 300, notes: '测试备注', status: '正常' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.record.poopType).toBe(4);
        expect(res.body.record.duration).toBe(300);
    });

    test('创建记录：未来日期应返回 400', async () => {
        const future = new Date();
        future.setDate(future.getDate() + 1);
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, date: future.toISOString() });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能晚于今天');
    });

    test('创建记录：无效日期格式应返回 400', async () => {
        const res = await request(app).post('/api/record')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 4, date: 'invalid-date' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('日期格式无效');
    });
});

describe('记录 API - 权限校验', () => {
    let recordId;

    beforeEach(() => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        recordId = result.lastInsertRowid;
    });

    afterEach(() => {
        db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
    });

    test('更新记录：非本人记录应返回 404', async () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other', 'other@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        const otherRecordId = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, new Date().toISOString(), 4, new Date().toISOString()
        ).lastInsertRowid;

        const res = await request(app).put(`/api/record/${otherRecordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 5 });
        expect(res.status).toBe(404);

        db.prepare('DELETE FROM records WHERE id = ?').run(otherRecordId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });

    test('删除记录：非本人记录应返回 403', async () => {
        const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other2', 'other2@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        const otherRecordId = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            otherUserId, new Date().toISOString(), 4, new Date().toISOString()
        ).lastInsertRowid;

        const res = await request(app).delete(`/api/delete/${otherRecordId}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);

        db.prepare('DELETE FROM records WHERE id = ?').run(otherRecordId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
    });

    test('删除记录：本人记录应成功', async () => {
        const res = await request(app).delete(`/api/delete/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('管理员 API - 权限校验', () => {
    test('普通用户访问管理员接口应返回 403', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('管理员权限');
    });

    test('管理员访问用户列表应成功', async () => {
        const res = await request(app).get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
        expect(res.body.users.length).toBeGreaterThan(0);
    });

    test('管理员删除任意记录应成功', async () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        const recordId = result.lastInsertRowid;

        const res = await request(app).delete(`/api/admin/record/${recordId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
        expect(record).toBeUndefined();
    });

    test('无认证访问管理员接口应返回 401', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });
});

describe('管理员 API - 完整功能', () => {
    test('管理员获取记录列表应成功', async () => {
        const res = await request(app).get('/api/admin/records')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.total).toBeDefined();
        expect(res.body.page).toBeDefined();
    });

    test('管理员获取统计信息应成功', async () => {
        const res = await request(app).get('/api/admin/stats')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.userCount).toBeDefined();
        expect(res.body.recordCount).toBeDefined();
        expect(res.body.adminCount).toBeDefined();
        expect(res.body.todayCount).toBeDefined();
        expect(res.body.typeDistribution).toBeDefined();
        expect(res.body.trend).toBeDefined();
    });

    test('管理员重置用户密码应成功', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'newpassword123' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('testuser');

        const loginRes = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'newpassword123'
        });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
    });

    test('管理员重置密码：密码太短应返回 400', async () => {
        const res = await request(app).post(`/api/admin/user/${testUserId}/password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: '12345' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('至少6位');
    });

    test('管理员删除用户：不能删除自己', async () => {
        const res = await request(app).delete(`/api/admin/user/${adminUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除自己');
    });

    test('管理员删除用户：不能删除管理员', async () => {
        const anotherAdminId = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('anotheradmin', 'anotheradmin@test.com', bcrypt.hashSync('pass', 10), 'admin').lastInsertRowid;
        
        const res = await request(app).delete(`/api/admin/user/${anotherAdminId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('不能删除管理员');
        
        db.prepare('DELETE FROM users WHERE id = ?').run(anotherAdminId);
    });

    test('管理员删除普通用户应成功', async () => {
        const newUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('deleteuser', 'delete@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
        
        const res = await request(app).delete(`/api/admin/user/${newUserId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);
        expect(user).toBeUndefined();
    });
});

describe('周/月视图 API', () => {
    test('周视图应返回正确数据', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, new Date().toISOString()
        );

        const res = await request(app).get('/api/weekly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.range).toBeDefined();
        expect(res.body.days).toBeDefined();
        expect(res.body.summary).toBeDefined();
        expect(res.body.days.length).toBe(7);

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('月视图应返回正确数据', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, new Date().toISOString()
        );

        const res = await request(app).get('/api/monthly')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.month).toBeDefined();
        expect(res.body.range).toBeDefined();
        expect(res.body.days).toBeDefined();
        expect(res.body.weeks).toBeDefined();
        expect(res.body.summary).toBeDefined();
        expect(res.body.compareWithLastMonth).toBeDefined();

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

describe('用户修改密码 API', () => {
    test('修改密码：缺少字段应返回 400', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('完整信息');
    });

    test('修改密码：新密码太短应返回 400', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ oldPassword: 'newpassword123', newPassword: '12345' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('至少6位');
    });

    test('修改密码：旧密码错误应返回 400', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ oldPassword: 'wrong', newPassword: 'anotherpassword123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('旧密码错误');
    });

    test('修改密码：成功修改应返回成功', async () => {
        const res = await request(app).post('/api/user/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ oldPassword: 'newpassword123', newPassword: 'anotherpassword123' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('成功');

        const loginRes = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'anotherpassword123'
        });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
    });
});

describe('导出 API', () => {
    test('导出 CSV 应成功', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, '正常', '测试备注', new Date().toISOString()
        );

        const res = await request(app).get('/api/export')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('.csv');

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('导出 TXT 应成功', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, new Date().toISOString()
        );

        const res = await request(app).get('/api/export?format=txt')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.headers['content-disposition']).toContain('.txt');

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

describe('公共 API', () => {
    test('获取大便类型列表应成功', async () => {
        const res = await request(app).get('/api/poop-types');
        expect(res.status).toBe(200);
        expect(res.body.types).toBeDefined();
        expect(res.body.types.length).toBe(7);
    });
});

describe('首页 API', () => {
    test('获取首页数据应成功', async () => {
        const today = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300, new Date().toISOString()
            );
        }

        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.streak).toBeDefined();
        expect(res.body.records).toBeDefined();
        expect(res.body.last7).toBeDefined();
        expect(res.body.last7.count).toBe(3);
        expect(res.body.last7.poopTypeStats).toBeDefined();

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('无记录时首页数据应返回零值', async () => {
        const res = await request(app).get('/api/home')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.streak).toBe(0);
        expect(res.body.records).toEqual([]);
        expect(res.body.last7.count).toBe(0);
    });
});

describe('历史记录 API', () => {
    test('获取历史记录应成功', async () => {
        const today = new Date();
        for (let i = 0; i < 5; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, new Date().toISOString()
            );
        }

        const res = await request(app).get('/api/history')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.records.length).toBe(5);

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

describe('记录列表 API', () => {
    test('获取记录列表应成功', async () => {
        const today = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, d.toISOString(), 4, 300, new Date().toISOString()
            );
        }

        const res = await request(app).get('/api/records')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.stats).toBeDefined();
        expect(res.body.filter).toBeDefined();
        expect(res.body.records.length).toBe(3);

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });

    test('带筛选条件的记录列表应成功', async () => {
        const today = new Date();
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 4, 300, new Date().toISOString()
        );
        db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
            testUserId, today.toISOString(), 3, 200, new Date().toISOString()
        );

        const res = await request(app).get('/api/records?poop_type=4')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records.length).toBe(1);
        expect(res.body.records[0].poopType).toBe(4);

        db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
    });
});

describe('更新记录 API', () => {
    test('更新记录：有效数据应成功', async () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, duration, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, 300, '正常', '旧备注', new Date().toISOString()
        );
        const recordId = result.lastInsertRowid;

        const res = await request(app).put(`/api/record/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 5, duration: 420, status: '顺畅', notes: '新备注' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.record.poopType).toBe(5);
        expect(res.body.record.duration).toBe(420);
        expect(res.body.record.status).toBe('顺畅');
        expect(res.body.record.notes).toBe('新备注');

        db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
    });

    test('更新记录：无效类型值应返回 400', async () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        const recordId = result.lastInsertRowid;

        const res = await request(app).put(`/api/record/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 8 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('无效的大便类型');

        db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
    });

    test('更新记录：无效时长应返回 400', async () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        const recordId = result.lastInsertRowid;

        const res = await request(app).put(`/api/record/${recordId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ duration: 999999 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('无效的持续时长');

        db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
    });

    test('更新记录：记录不存在应返回 404', async () => {
        const res = await request(app).put('/api/record/999999')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ poop_type: 5 });
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('记录不存在');
    });
});

describe('设置 API', () => {
    test('获取设置应成功', async () => {
        const res = await request(app).get('/api/settings')
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.hour).toBe(8);
        expect(res.body.minute).toBe(0);
    });

    test('更新设置应成功', async () => {
        const res = await request(app).post('/api/settings')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ hour: 9, minute: 30 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.reminderTime.hour).toBe(9);
        expect(res.body.reminderTime.minute).toBe(30);
    });
});

describe('管理员 API - 边界条件', () => {
    test('管理员删除不存在的用户应返回 404', async () => {
        const res = await request(app).delete('/api/admin/user/999999')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });

    test('管理员重置不存在用户的密码应返回 404', async () => {
        const res = await request(app).post('/api/admin/user/999999/password')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'password123' });
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('用户不存在');
    });

    test('管理员获取记录列表：带筛选条件应成功', async () => {
        const result = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
            testUserId, new Date().toISOString(), 4, new Date().toISOString()
        );
        const recordId = result.lastInsertRowid;

        const res = await request(app).get(`/api/admin/records?user_id=${testUserId}&limit=10&offset=0`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.records).toBeDefined();
        expect(res.body.total).toBeGreaterThan(0);

        db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
    });
});

describe('错误处理路径', () => {
    test('注册失败应返回 500', async () => {
        const originalPrepare = db.prepare;
        db.prepare = jest.fn(() => ({
            get: jest.fn(() => null),
            run: jest.fn(() => { throw new Error('Database error'); })
        }));

        const res = await request(app).post('/api/register').send({
            username: 'testregister',
            email: 'testregister@test.com',
            password: 'password123'
        });
        expect(res.status).toBe(500);
        expect(res.body.error).toContain('注册失败');

        db.prepare = originalPrepare;
    });

    test('登录失败应返回 500', async () => {
        const originalPrepare = db.prepare;
        db.prepare = jest.fn(() => ({
            get: jest.fn(() => { throw new Error('Database error'); })
        }));

        const res = await request(app).post('/api/login').send({
            email: 'test@test.com',
            password: 'test123'
        });
        expect(res.status).toBe(500);
        expect(res.body.error).toContain('登录失败');

        db.prepare = originalPrepare;
    });
});
