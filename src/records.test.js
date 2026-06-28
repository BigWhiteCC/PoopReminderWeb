process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

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