process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

describe('database - 数据库模块', () => {
    let mockDb;
    let mockPrepare;
    let mockRun;
    let mockAll;
    let mockGet;
    let mockExec;

    beforeEach(() => {
        jest.resetModules();
        
        mockRun = jest.fn();
        mockAll = jest.fn().mockReturnValue([]);
        mockGet = jest.fn().mockReturnValue(null);
        mockExec = jest.fn();
        mockPrepare = jest.fn().mockReturnValue({
            run: mockRun,
            all: mockAll,
            get: mockGet
        });
        mockDb = {
            pragma: jest.fn(),
            exec: mockExec,
            prepare: mockPrepare
        };

        jest.mock('better-sqlite3', () => jest.fn(() => mockDb));
    });

    describe('initializeDatabase - 数据库初始化', () => {
        test('应创建所有必要的表', () => {
            const { initializeDatabase } = require('./database');
            initializeDatabase();
            expect(mockExec).toHaveBeenCalled();
        });
    });

    describe('addLoginLog - 登录日志', () => {
        test('应正确记录成功登录', () => {
            const { addLoginLog } = require('./database');
            addLoginLog(1, {
                type: '桌面电脑',
                browser: 'Chrome',
                os: 'Windows',
                model: 'PC',
                ip: '192.168.1.1',
                userAgent: 'test UA'
            }, true);
            expect(mockPrepare).toHaveBeenCalled();
            expect(mockRun).toHaveBeenCalledWith(
                1, '桌面电脑', 'Chrome', 'Windows', 'PC', '192.168.1.1', 'test UA', 1, null
            );
        });

        test('应正确记录失败登录', () => {
            const { addLoginLog } = require('./database');
            addLoginLog(null, {
                type: '移动设备',
                browser: 'Safari',
                os: 'iOS',
                model: 'iPhone',
                ip: '10.0.0.1',
                userAgent: 'test UA'
            }, false, '用户不存在');
            expect(mockPrepare).toHaveBeenCalled();
            expect(mockRun).toHaveBeenCalledWith(
                null, '移动设备', 'Safari', 'iOS', 'iPhone', '10.0.0.1', 'test UA', 0, '用户不存在'
            );
        });
    });

    describe('addAuditLog - 审计日志', () => {
        test('应正确记录管理员操作', () => {
            const { addAuditLog } = require('./database');
            addAuditLog(1, 'DELETE_USER', 'user', 1, '删除用户: testuser');
            expect(mockPrepare).toHaveBeenCalled();
            expect(mockRun).toHaveBeenCalledWith(1, 'DELETE_USER', 'user', 1, '删除用户: testuser');
        });

        test('应支持不带 detail 的记录', () => {
            const { addAuditLog } = require('./database');
            addAuditLog(1, 'VIEW_STATS', 'stats', null);
            expect(mockPrepare).toHaveBeenCalled();
            expect(mockRun).toHaveBeenCalledWith(1, 'VIEW_STATS', 'stats', null, null);
        });
    });

    describe('closeDb - 数据库关闭', () => {
        test('应正确关闭数据库连接', () => {
            const { closeDb } = require('./database');
            expect(() => { closeDb(); }).not.toThrow();
        });
    });
});