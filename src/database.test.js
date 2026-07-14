/**
 * 实际 src/database.js 写入函数的单元测试
 * 重点覆盖：addLoginLog（登录审计：成功/失败/异常用户）和 addAuditLog（管理员操作审计）。
 *
 * 由于 addLoginLog/addAuditLog 内部对 ./database 模块的 getDb 存在闭包引用，
 * 无法通过 jest.mock 替换。我们切换到隔离的临时目录，使用真实的 getDb，
 * 但保证每个测试套件使用独立的 DB 文件并彻底清理。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// JWT_SECRET 必须存在，否则 config.js 会 process.exit
process.env.JWT_SECRET = 'database-test-secret';
process.env.NODE_ENV = 'test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poop-db-test-'));
const cwdBefore = process.cwd();
process.chdir(tmpDir);

const Database = require('better-sqlite3');
const { addLoginLog, addAuditLog, closeDb, initializeDatabase } = require('./database');

// 初始化 schema（不写入种子用户）
initializeDatabase();

// 准备依赖：login_logs 和 admin_audit_logs 都有外键到 users
{
    const db = new Database('poopreminder.db');
    db.prepare('INSERT OR IGNORE INTO users (id, username, email, password) VALUES (?, ?, ?, ?)')
        .run(1, 'admin_user', 'admin@test.com', 'hash');
    db.prepare('INSERT OR IGNORE INTO users (id, username, email, password) VALUES (?, ?, ?, ?)')
        .run(7, 'normal_user', 'normal@test.com', 'hash');
    db.close();
}

afterAll(() => {
    try { closeDb(); } catch (e) { /* 忽略 */ }
    process.chdir(cwdBefore);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

// 直接打开当前工作目录下的 db 文件来断言
function openTestDb() {
    return new Database('poopreminder.db', { readonly: true, fileMustExist: true });
}

const deviceFixture = {
    type: '桌面电脑',
    browser: 'Chrome',
    os: 'Windows 10/11',
    model: 'Windows PC',
    ip: '192.168.1.10',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0'
};

beforeEach(() => {
    // 清空两个日志表（schema 由 initializeDatabase 在 beforeAll 创建）
    const db = new Database('poopreminder.db');
    db.prepare('DELETE FROM login_logs').run();
    db.prepare('DELETE FROM admin_audit_logs').run();
    db.close();
});

describe('addLoginLog - 登录审计', () => {
    test('成功登录应记录 success=1 且无失败原因', () => {
        addLoginLog(7, deviceFixture, true);
        const db = openTestDb();
        const row = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').get(7);
        db.close();
        expect(row).toBeDefined();
        expect(row.success).toBe(1);
        expect(row.fail_reason).toBeNull();
        expect(row.device_type).toBe('桌面电脑');
        expect(row.device_browser).toBe('Chrome');
        expect(row.device_os).toBe('Windows 10/11');
        expect(row.device_model).toBe('Windows PC');
        expect(row.ip).toBe('192.168.1.10');
    });

    test('失败登录应记录 success=0 与失败原因', () => {
        addLoginLog(7, deviceFixture, false, '密码错误');
        const db = openTestDb();
        const row = db.prepare('SELECT * FROM login_logs WHERE user_id = ?').get(7);
        db.close();
        expect(row.success).toBe(0);
        expect(row.fail_reason).toBe('密码错误');
    });

    test('用户不存在（userId=null）登录失败应记录 null user_id', () => {
        addLoginLog(null, deviceFixture, false, '用户不存在');
        const db = openTestDb();
        const row = db.prepare('SELECT * FROM login_logs WHERE user_id IS NULL').get();
        db.close();
        expect(row).toBeDefined();
        expect(row.success).toBe(0);
        expect(row.fail_reason).toBe('用户不存在');
    });

    test('多条日志应按插入顺序累加', () => {
        addLoginLog(7, deviceFixture, false, '密码错误');
        addLoginLog(7, deviceFixture, false, '密码错误');
        addLoginLog(7, deviceFixture, true);
        const db = openTestDb();
        const rows = db.prepare('SELECT success FROM login_logs WHERE user_id = ? ORDER BY id').all(7);
        db.close();
        expect(rows.length).toBe(3);
        expect(rows[0].success).toBe(0);
        expect(rows[1].success).toBe(0);
        expect(rows[2].success).toBe(1);
    });

    test('成功标志 truthy/falsy 都被规范化为 0/1', () => {
        addLoginLog(7, deviceFixture, 1);
        addLoginLog(7, deviceFixture, 0);
        const db = openTestDb();
        const rows = db.prepare('SELECT success FROM login_logs WHERE user_id = ? ORDER BY id').all(7);
        db.close();
        expect(rows[0].success).toBe(1);
        expect(rows[1].success).toBe(0);
    });
});

describe('addAuditLog - 管理员操作审计', () => {
    test('应正确记录操作审计日志', () => {
        addAuditLog(1, 'DELETE_RECORD', 'record', 42, '删除用户1的记录');
        const db = openTestDb();
        const row = db.prepare('SELECT * FROM admin_audit_logs WHERE admin_id = ?').get(1);
        db.close();
        expect(row).toBeDefined();
        expect(row.action).toBe('DELETE_RECORD');
        expect(row.target_type).toBe('record');
        expect(row.target_id).toBe(42);
        expect(row.detail).toBe('删除用户1的记录');
    });

    test('省略 detail 应允许 null', () => {
        addAuditLog(1, 'ENABLE_USER', 'user', 5);
        const db = openTestDb();
        const row = db.prepare('SELECT * FROM admin_audit_logs WHERE admin_id = ?').get(1);
        db.close();
        expect(row).toBeDefined();
        expect(row.detail).toBeNull();
    });

    test('target_id 可为 null（针对未指定具体对象）', () => {
        addAuditLog(1, 'EXPORT_DATA', 'global', null, '导出全部记录');
        const db = openTestDb();
        const row = db.prepare('SELECT * FROM admin_audit_logs WHERE action = ?').get('EXPORT_DATA');
        db.close();
        expect(row).toBeDefined();
        expect(row.target_id).toBeNull();
    });

    test('多条审计日志应可区分', () => {
        addAuditLog(1, 'RESET_PASSWORD', 'user', 1, '重置用户A的密码');
        addAuditLog(1, 'DELETE_USER', 'user', 2, '删除用户B');
        const db = openTestDb();
        const rows = db.prepare('SELECT action FROM admin_audit_logs ORDER BY id').all();
        db.close();
        expect(rows.length).toBe(2);
        expect(rows[0].action).toBe('RESET_PASSWORD');
        expect(rows[1].action).toBe('DELETE_USER');
    });
});
