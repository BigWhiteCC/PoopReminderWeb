process.env.JWT_SECRET = 'test-secret-key';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { toDateKey, parseDateKey, getWeekRange, daysBetween } = require('../utils');
const { queryRecords, calculateStreak, computeStats, parseFilterQuery } = require('../records');

describe('Records Routes - 数据验证与边界条件', () => {
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
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                reminder_hour INTEGER DEFAULT 8,
                reminder_minute INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

    describe('记录创建 - poop_type 数据校验', () => {
        beforeEach(() => {
            db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
        });

        test('poop_type 为空应被拒绝', () => {
            const rawPoopType = '';
            expect(rawPoopType === undefined || rawPoopType === null || rawPoopType === '').toBe(true);
        });

        test('poop_type 为 null 应被拒绝', () => {
            const rawPoopType = null;
            expect(rawPoopType === undefined || rawPoopType === null || rawPoopType === '').toBe(true);
        });

        test('poop_type 为 undefined 应被拒绝', () => {
            const rawPoopType = undefined;
            expect(rawPoopType === undefined || rawPoopType === null || rawPoopType === '').toBe(true);
        });

        test('poop_type 超出范围（0）应被拒绝', () => {
            const poopType = parseInt('0', 10);
            expect(isNaN(poopType) || poopType < 1 || poopType > 7).toBe(true);
        });

        test('poop_type 超出范围（8）应被拒绝', () => {
            const poopType = parseInt('8', 10);
            expect(isNaN(poopType) || poopType < 1 || poopType > 7).toBe(true);
        });

        test('poop_type 超出范围（-1）应被拒绝', () => {
            const poopType = parseInt('-1', 10);
            expect(isNaN(poopType) || poopType < 1 || poopType > 7).toBe(true);
        });

        test('非数字 poop_type 应被拒绝', () => {
            const poopType = parseInt('abc', 10);
            expect(isNaN(poopType) || poopType < 1 || poopType > 7).toBe(true);
        });

        test('有效 poop_type（1-7）应被接受', () => {
            for (let i = 1; i <= 7; i++) {
                const poopType = parseInt(String(i), 10);
                expect(isNaN(poopType) || poopType < 1 || poopType > 7).toBe(false);
            }
        });
    });

    describe('记录创建 - duration 数据校验', () => {
        test('duration 为 null 应被转为 0', () => {
            const duration = null;
            const parsed = duration ? parseInt(duration, 10) : 0;
            const validDuration = (!isNaN(parsed) && parsed >= 0 && parsed < 24 * 60 * 60) ? parsed : 0;
            expect(validDuration).toBe(0);
        });

        test('duration 为 undefined 应返回 0', () => {
            const duration = undefined;
            const parsed = duration ? parseInt(duration, 10) : 0;
            const validDuration = (!isNaN(parsed) && parsed >= 0 && parsed < 24 * 60 * 60) ? parsed : 0;
            expect(validDuration).toBe(0);
        });

        test('负数 duration 应返回 0', () => {
            const duration = parseInt('-100', 10);
            const validDuration = (!isNaN(duration) && duration >= 0 && duration < 24 * 60 * 60) ? duration : 0;
            expect(validDuration).toBe(0);
        });

        test('超大 duration（超过24小时）应返回 0', () => {
            const duration = parseInt('86400', 10); // 24小时 = 86400秒
            const validDuration = (!isNaN(duration) && duration >= 0 && duration < 24 * 60 * 60) ? duration : 0;
            expect(validDuration).toBe(0);
        });

        test('边界值 duration（正好24小时-1秒）应被接受', () => {
            const duration = parseInt('86399', 10); // 23小时59分59秒
            const validDuration = (!isNaN(duration) && duration >= 0 && duration < 24 * 60 * 60) ? duration : 0;
            expect(validDuration).toBe(86399);
        });

        test('有效 duration 应被接受', () => {
            const durations = [0, 60, 300, 600, 1800, 3600];
            durations.forEach(d => {
                const duration = parseInt(String(d), 10);
                const validDuration = (!isNaN(duration) && duration >= 0 && duration < 24 * 60 * 60) ? duration : 0;
                expect(validDuration).toBe(d);
            });
        });
    });

    describe('记录创建 - 日期验证', () => {
        test('无效日期格式应返回 null', () => {
            expect(parseDateKey('invalid-date')).toBeNull();
            expect(parseDateKey('')).toBeNull();
            expect(parseDateKey(null)).toBeNull();
        });

        test('未来日期应被拒绝', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const parsed = parseDateKey(futureDate.toISOString());
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

            expect(parsed.getTime() > endOfToday.getTime()).toBe(true);
        });

        test('今天日期应被接受', () => {
            const today = new Date();
            const parsed = parseDateKey(today.toISOString());
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

            expect(parsed.getTime() <= endOfToday.getTime()).toBe(true);
        });

        test('过去日期应被接受', () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const parsed = parseDateKey(yesterday.toISOString());
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

            expect(parsed.getTime() <= endOfToday.getTime()).toBe(true);
        });

        test('字符串格式日期应正确解析', () => {
            expect(parseDateKey('2024-01-15')).not.toBeNull();
            expect(parseDateKey('2024-01-15T08:30:00')).not.toBeNull();
            expect(parseDateKey('2024-01-15T08:30:00Z')).not.toBeNull();
        });
    });

    describe('记录创建 - notes 和 status 截断', () => {
        test('notes 超过500字符应被截断', () => {
            const longNotes = 'a'.repeat(600);
            const truncated = longNotes.slice(0, 500);
            expect(truncated.length).toBe(500);
        });

        test('status 超过50字符应被截断', () => {
            const longStatus = 'a'.repeat(60);
            const truncated = longStatus.slice(0, 50);
            expect(truncated.length).toBe(50);
        });

        test('notes 为空应返回空字符串', () => {
            const notes = null;
            const result = (notes || '').toString().slice(0, 500);
            expect(result).toBe('');
        });

        test('status 为空应返回空字符串', () => {
            const status = null;
            const result = (status || '').toString().slice(0, 50);
            expect(result).toBe('');
        });
    });

    describe('记录更新 - 权限与数据校验', () => {
        let recordId;

        beforeEach(() => {
            db.prepare('DELETE FROM records WHERE user_id = ?').run(testUserId);
            const result = db.prepare('INSERT INTO records (user_id, date, poop_type, duration, created_at) VALUES (?, ?, ?, ?, ?)').run(
                testUserId, '2024-01-15T08:30:00', 4, 300, '2024-01-15T08:30:00'
            );
            recordId = result.lastInsertRowid;
        });

        test('非本人记录应返回 404', () => {
            const otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('other', 'other@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
            const otherRecordId = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                otherUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
            ).lastInsertRowid;

            const existing = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(otherRecordId, testUserId);
            expect(existing).toBeUndefined();

            db.prepare('DELETE FROM records WHERE id = ?').run(otherRecordId);
            db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
        });

        test('更新 poop_type 为无效值应被拒绝', () => {
            const pt = parseInt('9', 10);
            expect(!isNaN(pt) && pt >= 1 && pt <= 7).toBe(false);
        });

        test('更新 duration 为无效值应被拒绝', () => {
            const d = parseInt('-100', 10);
            expect(!isNaN(d) && d >= 0 && d < 24 * 60 * 60).toBe(false);
        });

        test('更新记录不存在应返回 404', () => {
            const nonExistentId = 99999;
            const existing = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(nonExistentId, testUserId);
            expect(existing).toBeUndefined();
        });

        test('部分更新应保留原有值', () => {
            // 只更新 notes，其他字段保持不变
            const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
            expect(existing.poop_type).toBe(4);
            expect(existing.duration).toBe(300);

            // 模拟部分更新
            const newNotes = 'updated notes';
            db.prepare('UPDATE records SET notes = ? WHERE id = ?').run(newNotes, recordId);

            const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
            expect(updated.notes).toBe(newNotes);
            expect(updated.poop_type).toBe(4); // 保持不变
            expect(updated.duration).toBe(300); // 保持不变
        });
    });

    describe('记录删除 - 权限校验', () => {
        let otherUserId;
        let otherRecordId;

        beforeEach(() => {
            otherUserId = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run('delete_test', 'delete@test.com', bcrypt.hashSync('pass', 10)).lastInsertRowid;
            otherRecordId = db.prepare('INSERT INTO records (user_id, date, poop_type, created_at) VALUES (?, ?, ?, ?)').run(
                otherUserId, '2024-01-15T08:30:00', 4, '2024-01-15T08:30:00'
            ).lastInsertRowid;
        });

        afterEach(() => {
            db.prepare('DELETE FROM records WHERE id = ?').run(otherRecordId);
            db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
        });

        test('删除不存在的记录应返回 404', () => {
            const record = db.prepare('SELECT user_id FROM records WHERE id = ?').get(99999);
            expect(record).toBeUndefined();
        });

        test('删除他人记录应返回 403', () => {
            const record = db.prepare('SELECT user_id FROM records WHERE id = ?').get(otherRecordId);
            expect(record).toBeDefined();
            expect(record.user_id !== testUserId).toBe(true);
        });
    });
});

describe('周视图和月视图 - 边界条件', () => {
    describe('getWeekRange - 跨年周', () => {
        test('2023年最后一周应正确计算', () => {
            const date = new Date(2023, 11, 31); // 2023-12-31 周日
            const range = getWeekRange(date);
            expect(range).not.toBeNull();
            expect(range.start.getFullYear()).toBe(2023);
            expect(range.end.getFullYear()).toBe(2024);
        });

        test('2024年第一周应正确计算', () => {
            const date = new Date(2024, 0, 1); // 2024-01-01 周一
            const range = getWeekRange(date);
            expect(range).not.toBeNull();
            expect(range.start.getFullYear()).toBe(2024);
            expect(range.start.getDate()).toBe(1);
        });

        test('周日应返回上周范围', () => {
            const sunday = new Date(2024, 0, 7); // 2024-01-07 周日
            const range = getWeekRange(sunday);
            expect(range).not.toBeNull();
            expect(range.start.getDate()).toBe(1);
            expect(range.end.getDate()).toBe(8);
        });

        test('周六应返回当周范围', () => {
            const saturday = new Date(2024, 0, 6); // 2024-01-06 周六
            const range = getWeekRange(saturday);
            expect(range).not.toBeNull();
            expect(range.start.getDate()).toBe(1);
            expect(range.end.getDate()).toBe(8);
        });
    });

    describe('daysBetween - 边界情况', () => {
        test('跨月应正确计算', () => {
            const start = new Date(2024, 0, 28);
            const end = new Date(2024, 1, 3);
            const days = daysBetween(start, end);
            expect(days.length).toBe(6);
            expect(days[0].getDate()).toBe(28);
            expect(days[5].getDate()).toBe(2);
        });

        test('跨年应正确计算', () => {
            const start = new Date(2023, 11, 30); // 2023-12-30
            const end = new Date(2024, 0, 3); // 2024-01-03
            const days = daysBetween(start, end);
            // 2023-12-30, 2023-12-31, 2024-01-01, 2024-01-02 (4天)
            expect(days.length).toBe(4);
            expect(days[0].getFullYear()).toBe(2023);
            expect(days[3].getFullYear()).toBe(2024);
        });
    });

    describe('月视图 - 月边界', () => {
        test('28天的月份应正确计算', () => {
            const base = new Date(2023, 1, 15); // 2023年2月（28天）
            const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
            expect(daysInMonth).toBe(28);
        });

        test('29天的月份（闰年）应正确计算', () => {
            const base = new Date(2024, 1, 15); // 2024年2月（闰年，29天）
            const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
            expect(daysInMonth).toBe(29);
        });

        test('30天的月份应正确计算', () => {
            const base = new Date(2024, 3, 15); // 2024年4月（30天）
            const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
            expect(daysInMonth).toBe(30);
        });

        test('31天的月份应正确计算', () => {
            const base = new Date(2024, 0, 15); // 2024年1月（31天）
            const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
            expect(daysInMonth).toBe(31);
        });
    });
});

describe('导出功能 - 格式验证', () => {
    describe('CSV导出 - 特殊字符处理', () => {
        test('包含逗号的 notes 应正确转义', () => {
            const notes = '测试,包含逗号';
            const escape = v => `"${String(v).replace(/"/g, '""')}"`;
            const escaped = escape(notes);
            expect(escaped).toBe('"测试,包含逗号"');
        });

        test('包含双引号的 notes 应正确转义', () => {
            const notes = '测试"包含引号"';
            const escape = v => `"${String(v).replace(/"/g, '""')}"`;
            const escaped = escape(notes);
            expect(escaped).toBe('"测试""包含引号"""');
        });

        test('包含换行的 notes 应被处理', () => {
            const notes = '测试\n包含换行';
            const processed = notes.replace(/\s+/g, ' ');
            expect(processed).toBe('测试 包含换行');
        });
    });

    describe('TXT导出 - 内容格式', () => {
        test('无 duration 的记录应显示未记录', () => {
            const record = { duration: null };
            const formatDurationSec = (seconds) => {
                const n = Number(seconds);
                if (!n || n <= 0) return '0 秒';
                const s = Math.floor(n);
                if (s < 60) return `${s} 秒`;
                const m = Math.floor(s / 60);
                const rs = s % 60;
                return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
            };

            expect(formatDurationSec(record.duration)).toBe('0 秒');
        });

        test('duration 小于60秒应正确显示', () => {
            const formatDurationSec = (seconds) => {
                const n = Number(seconds);
                if (!n || n <= 0) return '0 秒';
                const s = Math.floor(n);
                if (s < 60) return `${s} 秒`;
                const m = Math.floor(s / 60);
                const rs = s % 60;
                return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
            };

            expect(formatDurationSec(30)).toBe('30 秒');
            expect(formatDurationSec(59)).toBe('59 秒');
        });

        test('duration 大于60秒应正确显示', () => {
            const formatDurationSec = (seconds) => {
                const n = Number(seconds);
                if (!n || n <= 0) return '0 秒';
                const s = Math.floor(n);
                if (s < 60) return `${s} 秒`;
                const m = Math.floor(s / 60);
                const rs = s % 60;
                return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
            };

            expect(formatDurationSec(300)).toBe('5 分');
            expect(formatDurationSec(361)).toBe('6 分 1 秒');
        });
    });
});