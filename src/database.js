'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { IS_DEV } = require('./config');

let db;

function getDb() {
    if (!db) {
        db = new Database('poopreminder.db');
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
    }
    return db;
}

function initializeDatabase() {
    const db = getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
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

        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            reminder_hour INTEGER DEFAULT 8,
            reminder_minute INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            device_type TEXT,
            device_browser TEXT,
            device_os TEXT,
            device_model TEXT,
            ip TEXT,
            user_agent TEXT,
            success INTEGER NOT NULL DEFAULT 0,
            fail_reason TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES users(id)
        )
    `);

    // 向后兼容：旧库可能缺少新字段
    const addColumnIfMissing = (col, def, table = 'records') => {
        const info = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!info.some(c => c.name === col)) {
            try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
            catch (e) { /* 字段已存在，忽略 */ }
        }
    };

    addColumnIfMissing('poop_type', 'INTEGER');
    addColumnIfMissing('duration', 'INTEGER DEFAULT 0');
    addColumnIfMissing('status', 'TEXT');
    addColumnIfMissing('created_at', 'TEXT');
    addColumnIfMissing('role', "TEXT DEFAULT 'user'", 'users');
    addColumnIfMissing('password_changed_at', 'TEXT', 'users');
    addColumnIfMissing('enabled', 'INTEGER DEFAULT 1', 'users');
}

// -------- 登录日志 --------
function addLoginLog(userId, device, success, failReason = null) {
    const db = getDb();
    try {
        db.prepare(`
            INSERT INTO login_logs (user_id, device_type, device_browser, device_os, device_model, ip, user_agent, success, fail_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, device.type, device.browser, device.os, device.model,
            device.ip, device.userAgent, success ? 1 : 0, failReason
        );
    } catch (e) {
        console.error('[LoginLog] 记录失败:', e.message);
    }
}

// -------- 操作审计 --------
function addAuditLog(adminId, action, targetType, targetId, detail = null) {
    const db = getDb();
    try {
        db.prepare(`
            INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
            VALUES (?, ?, ?, ?, ?)
        `).run(adminId, action, targetType, targetId, detail);
    } catch (e) {
        console.error('[AuditLog] 记录失败:', e.message);
    }
}

function seedDevData() {
    const db = getDb();

    // -------- 测试账号 --------
    const TEST_EMAIL = 'test@example.com';
    const TEST_USERNAME = 'test';
    const TEST_PASSWORD = 'test123';

    try {
        const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(TEST_EMAIL);
        const testPwd = bcrypt.hashSync(TEST_PASSWORD, 10);
        let testUserId;

        if (byEmail) {
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(testPwd, byEmail.id);
            testUserId = byEmail.id;
            console.log(`👤 测试账号已就绪: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
        } else {
            const existingTest = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USERNAME);
            if (existingTest) {
                db.prepare('UPDATE users SET email = ?, password = ? WHERE id = ?').run(TEST_EMAIL, testPwd, existingTest.id);
                testUserId = existingTest.id;
                console.log(`👤 测试账号已重置为: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
            } else {
                const res = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(TEST_USERNAME, TEST_EMAIL, testPwd);
                testUserId = res.lastInsertRowid;
                console.log(`👤 测试账号已创建: ${TEST_USERNAME}/${TEST_EMAIL} / ${TEST_PASSWORD}`);
            }
        }

        // 填充最近 7 天的示例数据
        const recordCount = db.prepare('SELECT COUNT(*) as c FROM records WHERE user_id = ?').get(testUserId).c;
        if (recordCount === 0) {
            const insRec = db.prepare('INSERT INTO records (user_id, date, notes, poop_type, duration, status) VALUES (?, ?, ?, ?, ?, ?)');
            const types = [3, 4, 4, 5, 4, 3, 2];
            const notes = ['正常', '有点干', '正常', '偏软', '正常', '晨起', '偏稀'];
            const statuses = ['正常', '正常', '顺畅', '正常', '正常', '偏慢', '有点费力'];
            const durations = [300, 420, 240, 480, 300, 600, 360];
            for (let i = 0; i < 7; i++) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                insRec.run(testUserId, dateStr, notes[i], types[i], durations[i], statuses[i]);
            }
            console.log('📋 已为测试账号填充 7 条示例记录');
        }
    } catch (e) {
        console.log('测试账号创建失败:', e.message);
    }

    // -------- 管理员账号（仅首次创建时打印密码） --------
    try {
        const ADMIN_EMAIL = 'admin@example.com';
        const ADMIN_USERNAME = 'admin';
        const adminByEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);

        if (adminByEmail) {
            console.log(`🛡  管理员账号已就绪: ${ADMIN_USERNAME}/${ADMIN_EMAIL}`);
        } else {
            const randomPwd = crypto.randomBytes(12).toString('base64').slice(0, 16);
            const hashedPwd = bcrypt.hashSync(randomPwd, 10);
            db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run(ADMIN_USERNAME, ADMIN_EMAIL, hashedPwd, 'admin');
            console.log(`🛡  管理员账号已创建（仅显示一次，请妥善保存）:`);
            console.log(`   用户名: ${ADMIN_USERNAME}`);
            console.log(`   邮箱: ${ADMIN_EMAIL}`);
            console.log(`   密码: ${randomPwd}`);
        }
    } catch (e) {
        console.log('管理员账号创建失败:', e.message);
    }
}

function closeDb() {
    if (db) {
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        db.close();
        db = null;
    }
}

module.exports = { getDb, initializeDatabase, seedDevData, closeDb, addLoginLog, addAuditLog };
