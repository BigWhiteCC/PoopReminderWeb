process.env.JWT_SECRET = 'test-secret-key';

jest.mock('./database', () => {
    let mockDb;
    return {
        getDb: () => {
            if (!mockDb) {
                const Database = require('better-sqlite3');
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
                `);
            }
            return mockDb;
        }
    };
});

const {
    validateUsername,
    validateEmail,
    validatePassword,
    handleError,
    escapeHtml,
    authenticateToken,
    requireAdmin
} = require('./middleware');

describe('validateUsername - 用户名验证', () => {
    test('空值应返回错误', () => {
        expect(validateUsername(null)).toBe('用户名不能为空');
        expect(validateUsername(undefined)).toBe('用户名不能为空');
        expect(validateUsername('')).toBe('用户名不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validateUsername(123)).toBe('用户名不能为空');
        expect(validateUsername({})).toBe('用户名不能为空');
        expect(validateUsername([])).toBe('用户名不能为空');
    });

    test('长度不足2应返回错误', () => {
        expect(validateUsername('a')).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('长度超过20应返回错误', () => {
        expect(validateUsername('a'.repeat(21))).toBe('用户名长度需在 2-20 个字符之间');
    });

    test('包含特殊字符应返回错误', () => {
        expect(validateUsername('user@name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
        expect(validateUsername('user!name')).toBe('用户名只能包含中文、字母、数字、下划线和连字符');
    });

    test('有效用户名应返回 null', () => {
        expect(validateUsername('user')).toBeNull();
        expect(validateUsername('user_name')).toBeNull();
        expect(validateUsername('user-name')).toBeNull();
        expect(validateUsername('User123')).toBeNull();
        expect(validateUsername('用户名')).toBeNull();
        expect(validateUsername('中文User')).toBeNull();
    });

    test('首尾空格应被忽略', () => {
        expect(validateUsername('  user  ')).toBeNull();
    });
});

describe('validateEmail - 邮箱验证', () => {
    test('空值应返回错误', () => {
        expect(validateEmail(null)).toBe('邮箱不能为空');
        expect(validateEmail(undefined)).toBe('邮箱不能为空');
        expect(validateEmail('')).toBe('邮箱不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validateEmail(123)).toBe('邮箱不能为空');
    });

    test('无效格式应返回错误', () => {
        expect(validateEmail('user')).toBe('邮箱格式不正确');
        expect(validateEmail('user@')).toBe('邮箱格式不正确');
        expect(validateEmail('user@domain')).toBe('邮箱格式不正确');
        expect(validateEmail('@domain.com')).toBe('邮箱格式不正确');
        expect(validateEmail('user@.com')).toBe('邮箱格式不正确');
    });

    test('有效邮箱应返回 null', () => {
        expect(validateEmail('user@domain.com')).toBeNull();
        expect(validateEmail('user.name@domain.com')).toBeNull();
        expect(validateEmail('user+tag@domain.com')).toBeNull();
        expect(validateEmail('user@sub.domain.com')).toBeNull();
        expect(validateEmail('USER@DOMAIN.COM')).toBeNull();
    });

    test('首尾空格应被忽略', () => {
        expect(validateEmail('  user@domain.com  ')).toBeNull();
    });
});

describe('validatePassword - 密码验证', () => {
    test('空值应返回错误', () => {
        expect(validatePassword(null)).toBe('密码不能为空');
        expect(validatePassword(undefined)).toBe('密码不能为空');
        expect(validatePassword('')).toBe('密码不能为空');
    });

    test('非字符串应返回错误', () => {
        expect(validatePassword(123)).toBe('密码不能为空');
    });

    test('长度不足6位应返回错误', () => {
        expect(validatePassword('12345')).toBe('密码至少 6 位');
        expect(validatePassword('abc')).toBe('密码至少 6 位');
    });

    test('长度超过128位应返回错误', () => {
        expect(validatePassword('a'.repeat(129))).toBe('密码不能超过 128 位');
    });

    test('有效密码应返回 null', () => {
        expect(validatePassword('123456')).toBeNull();
        expect(validatePassword('abcdef')).toBeNull();
        expect(validatePassword('password123')).toBeNull();
        expect(validatePassword('a'.repeat(128))).toBeNull();
    });
});

describe('handleError - 错误处理', () => {
    test('SQLITE_CONSTRAINT_UNIQUE 应返回 409', () => {
        const err = new Error('SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed');
        const result = handleError(err, 'test');
        expect(result.status).toBe(409);
        expect(result.message).toBe('该数据已存在，请换一个试试');
    });

    test('SQLITE_CONSTRAINT 应返回 400', () => {
        const err = new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');
        const result = handleError(err, 'test');
        expect(result.status).toBe(400);
        expect(result.message).toBe('数据约束冲突，请检查输入');
    });

    test('SQLITE_ERROR 应返回 500', () => {
        const err = new Error('SQLITE_ERROR: no such table');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toBe('数据库操作失败，请稍后重试');
    });

    test('其他错误应返回 500 通用消息', () => {
        const err = new Error('Unexpected error');
        const result = handleError(err, 'test');
        expect(result.status).toBe(500);
        expect(result.message).toBe('服务器异常，请稍后重试');
    });

    test('应包含 context 参数', () => {
        const err = new Error('test error');
        handleError(err, 'register');
    });
});

describe('escapeHtml - HTML转义', () => {
    test('空值应返回空字符串', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml('')).toBe('');
    });

    test('特殊字符应被转义', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('>&<')).toBe('&gt;&amp;&lt;');
        expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
        expect(escapeHtml("'single'")).toBe('&#x27;single&#x27;');
        expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    });

    test('普通文本应保持不变', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
        expect(escapeHtml('123 test')).toBe('123 test');
        expect(escapeHtml('中文文本')).toBe('中文文本');
    });

    test('混合内容应正确转义', () => {
        expect(escapeHtml('<div class="test">Hello & World</div>'))
            .toBe('&lt;div class=&quot;test&quot;&gt;Hello &amp; World&lt;/div&gt;');
    });

    test('XSS攻击载荷应被转义', () => {
        const payload = '<script>alert("XSS")</script>';
        const escaped = escapeHtml(payload);
        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('</script>');
        expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });
});

describe('authenticateToken - 认证中间件', () => {
    const jwt = require('jsonwebtoken');
    const { getDb } = require('./database');
    let db;
    let testUserId;

    beforeAll(() => {
        db = getDb();
        const result = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run('testuser', 'test@test.com', 'hashed', 'user');
        testUserId = result.lastInsertRowid;
    });

    test('无 token 应返回 401', (done) => {
        const req = { headers: {} };
        const res = {
            status: (code) => {
                expect(code).toBe(401);
                return { json: (data) => {
                    expect(data.error).toBe('Unauthorized');
                    done();
                }};
            }
        };
        authenticateToken(req, res, () => {});
    });

    test('无效 token 应返回 403', (done) => {
        const req = { headers: { authorization: 'Bearer invalidtoken' } };
        const res = {
            status: (code) => {
                expect(code).toBe(403);
                return { json: (data) => {
                    expect(data.error).toBe('Invalid token');
                    done();
                }};
            }
        };
        authenticateToken(req, res, () => {});
    });

    test('有效 token 应调用 next', (done) => {
        const token = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, process.env.JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: (code) => ({ json: () => {} })
        };
        authenticateToken(req, res, () => {
            expect(req.user).toBeDefined();
            expect(req.user.userId).toBe(testUserId);
            done();
        });
    });

    test('密码修改后旧 token 应失效', (done) => {
        const token = jwt.sign({ userId: testUserId, username: 'testuser', role: 'user' }, process.env.JWT_SECRET);
        
        const futureTime = new Date(Date.now() + 10000).toISOString();
        db.prepare('UPDATE users SET password_changed_at = ? WHERE id = ?').run(futureTime, testUserId);

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: (code) => {
                expect(code).toBe(403);
                return { json: (data) => {
                    expect(data.error).toBe('Token expired due to password change');
                    done();
                }};
            }
        };
        authenticateToken(req, res, () => {
            done(new Error('不应调用 next'));
        });
    });

    test('用户不存在应返回 403', (done) => {
        const token = jwt.sign({ userId: 99999, username: 'nonexistent', role: 'user' }, process.env.JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: (code) => {
                expect(code).toBe(403);
                return { json: (data) => {
                    expect(data.error).toBe('User not found');
                    done();
                }};
            }
        };
        authenticateToken(req, res, () => {});
    });
});

describe('requireAdmin - 管理员权限中间件', () => {
    test('普通用户应返回 403', (done) => {
        const req = { user: { role: 'user' } };
        const res = {
            status: (code) => {
                expect(code).toBe(403);
                return { json: (data) => {
                    expect(data.error).toBe('需要管理员权限');
                    done();
                }};
            }
        };
        requireAdmin(req, res, () => {});
    });

    test('管理员应调用 next', (done) => {
        const req = { user: { role: 'admin' } };
        const res = {};
        requireAdmin(req, res, () => {
            done();
        });
    });

    test('无 user 对象应返回 403', (done) => {
        const req = {};
        const res = {
            status: (code) => {
                expect(code).toBe(403);
                return { json: (data) => {
                    expect(data.error).toBe('需要管理员权限');
                    done();
                }};
            }
        };
        requireAdmin(req, res, () => {});
    });
});