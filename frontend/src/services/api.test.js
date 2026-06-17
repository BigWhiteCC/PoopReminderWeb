const localStorageMock = {
    store: {},
    getItem: jest.fn((key) => localStorageMock.store[key] || null),
    setItem: jest.fn((key, value) => { localStorageMock.store[key] = value; }),
    removeItem: jest.fn((key) => { delete localStorageMock.store[key]; }),
    clear: jest.fn(() => { localStorageMock.store = {}; })
};
global.localStorage = localStorageMock;

global.fetch = jest.fn();

Object.defineProperty(global.navigator, 'clipboard', {
    value: {
        writeText: jest.fn(() => Promise.resolve())
    },
    writable: true
});

global.window = {
    isSecureContext: true
};

global.document = {
    createElement: jest.fn(() => ({
        href: '',
        download: '',
        style: {},
        value: '',
        focus: jest.fn(),
        select: jest.fn(),
        setSelectionRange: jest.fn(),
        setAttribute: jest.fn(),
        click: jest.fn()
    })),
    body: {
        appendChild: jest.fn(),
        removeChild: jest.fn()
    },
    execCommand: jest.fn(() => true)
};

global.URL = {
    createObjectURL: jest.fn(() => 'blob:test-url'),
    revokeObjectURL: jest.fn()
};

global.Blob = jest.fn((content, options) => ({ content, options }));

let api, ApiError, formatDuration, formatDurationShort;

beforeAll(async () => {
    const module = await import('./api.js');
    api = module.api;
    ApiError = module.ApiError;
    formatDuration = module.formatDuration;
    formatDurationShort = module.formatDurationShort;
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.store = {};
    fetch.mockClear();
});

describe('ApiError 类', () => {
    test('应正确创建 ApiError 实例', () => {
        const error = new ApiError('请求失败', 400, 'BAD_REQUEST');
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiError');
        expect(error.message).toBe('请求失败');
        expect(error.statusCode).toBe(400);
        expect(error.type).toBe('BAD_REQUEST');
    });

    test('默认 type 应为 UNKNOWN', () => {
        const error = new ApiError('未知错误', 500);
        expect(error.type).toBe('UNKNOWN');
    });

    test('应能被 catch 捕获并区分类型', () => {
        const error = new ApiError('网络错误', 0, 'NETWORK_ERROR');
        try {
            throw error;
        } catch (e) {
            expect(e instanceof ApiError).toBe(true);
            expect(e.type).toBe('NETWORK_ERROR');
        }
    });
});

describe('formatDuration - 时长格式化', () => {
    test('零或负数应返回 "0 秒"', () => {
        expect(formatDuration(0)).toBe('0 秒');
        expect(formatDuration(-1)).toBe('0 秒');
        expect(formatDuration(null)).toBe('0 秒');
        expect(formatDuration(undefined)).toBe('0 秒');
        expect(formatDuration('invalid')).toBe('0 秒');
    });

    test('小于 60 秒应返回秒数', () => {
        expect(formatDuration(30)).toBe('30 秒');
        expect(formatDuration(1)).toBe('1 秒');
        expect(formatDuration(59)).toBe('59 秒');
    });

    test('正好 60 秒应返回 "1 分"', () => {
        expect(formatDuration(60)).toBe('1 分');
    });

    test('超过 60 秒应返回分秒组合', () => {
        expect(formatDuration(90)).toBe('1 分 30 秒');
        expect(formatDuration(120)).toBe('2 分');
        expect(formatDuration(185)).toBe('3 分 5 秒');
    });

    test('大数值应正确计算', () => {
        expect(formatDuration(3600)).toBe('60 分');
        expect(formatDuration(3661)).toBe('61 分 1 秒');
    });

    test('字符串数字应正确解析', () => {
        expect(formatDuration('120')).toBe('2 分');
        expect(formatDuration('45')).toBe('45 秒');
    });
});

describe('formatDurationShort - 精简时长格式化', () => {
    test('零或负数应返回 "0 分"', () => {
        expect(formatDurationShort(0)).toBe('0 分');
        expect(formatDurationShort(-1)).toBe('0 分');
    });

    test('小于 60 秒应返回秒数', () => {
        expect(formatDurationShort(30)).toBe('30 秒');
        expect(formatDurationShort(59)).toBe('59 秒');
    });

    test('正好 60 秒应返回 "1 分"', () => {
        expect(formatDurationShort(60)).toBe('1 分');
    });

    test('超过 60 秒应返回分钟数（保留一位小数）', () => {
        expect(formatDurationShort(90)).toBe('1.5 分');
        expect(formatDurationShort(120)).toBe('2 分');
        expect(formatDurationShort(150)).toBe('2.5 分');
    });
});

describe('buildTextFromRecords - 文本生成', () => {
    const poopTypes = [
        { id: 1, name: '第1型', emoji: '🫘' },
        { id: 4, name: '第4型', emoji: '🍌' },
        { id: 7, name: '第7型', emoji: '💧' }
    ];

    test('空记录数组应生成提示文本', () => {
        const text = api.buildTextFromRecords([], { poopTypes });
        expect(text).toContain('共 0 条记录');
        expect(text).toContain('暂无记录');
    });

    test('单条记录应正确格式化', () => {
        const records = [
            { date: '2024-01-15T08:30:00', poopType: 4, duration: 300 }
        ];
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('共 1 条记录');
        expect(text).toContain('1.');
        expect(text).toContain('类型: 🍌');
        expect(text).toContain('时长: 5 分');
    });

    test('多条记录应正确统计', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: 300 },
            { date: '2024-01-15T12:00:00', poopType: 1, duration: 600 },
            { date: '2024-01-14T08:00:00', poopType: 7, duration: 120 }
        ];
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('共 3 条记录');
        expect(text).toContain('总次数: 3');
        expect(text).toContain('平均时长: 5 分');
        expect(text).toContain('🍌 第4型: 1 次');
        expect(text).toContain('🫘 第1型: 1 次');
        expect(text).toContain('💧 第7型: 1 次');
    });

    test('无时长记录应显示未记录', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 4, duration: null }
        ];
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('时长: 未记录');
    });

    test('未匹配的类型应显示编号', () => {
        const records = [
            { date: '2024-01-15T08:00:00', poopType: 5, duration: 100 }
        ];
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('类型: 编号 5');
    });

    test('自定义标题应生效', () => {
        const records = [];
        const text = api.buildTextFromRecords(records, { title: '本周记录', poopTypes });
        expect(text).toContain('本周记录');
    });

    test('无效日期应显示 "-"', () => {
        const records = [
            { date: 'invalid', poopType: 4, duration: 100 }
        ];
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('-');
    });
});

describe('copyTextToClipboard - 剪贴板操作', () => {
    test('在安全上下文应使用 navigator.clipboard', async () => {
        await api.copyTextToClipboard('test text');
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
    });

    test('应返回 true 表示成功', async () => {
        const result = await api.copyTextToClipboard('test');
        expect(result).toBe(true);
    });
});

describe('downloadAsTxt - 下载文本', () => {
    test('应正确创建下载链接', () => {
        api.downloadAsTxt('test content', 'test_file');
        expect(document.createElement).toHaveBeenCalledWith('a');
        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(document.body.appendChild).toHaveBeenCalled();
    });

    test('文件名应被安全处理', () => {
        api.downloadAsTxt('test', 'file/name?with*special:chars');
        const a = document.createElement.mock.results[0].value;
        expect(a.download).toBe('file_name_with_special_chars.txt');
    });
});

describe('request 函数 - HTTP 请求', () => {
    test('应添加 Authorization 头', async () => {
        localStorageMock.store.token = 'test-token';
        fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true })
        });

        await api.getUserInfo();

        expect(fetch).toHaveBeenCalledWith(
            '/api/user',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-token'
                })
            })
        );
    });

    test('401 错误应清除本地存储', async () => {
        localStorageMock.store.token = 'test-token';
        localStorageMock.store.user = JSON.stringify({ id: 1 });

        fetch.mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: '未授权' })
        });

        await expect(api.getUserInfo()).rejects.toThrow();
        expect(localStorage.removeItem).toHaveBeenCalledWith('token');
        expect(localStorage.removeItem).toHaveBeenCalledWith('user');
    });

    test('404 错误应抛出 ApiError', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ error: '不存在' })
        });

        await expect(api.getUserInfo()).rejects.toThrow(ApiError);
    });

    test('网络错误应抛出 NETWORK_ERROR', async () => {
        fetch.mockRejectedValue(new TypeError('fetch failed'));

        await expect(api.getUserInfo()).rejects.toMatchObject({
            type: 'NETWORK_ERROR',
            statusCode: 0
        });
    });
});

describe('边界条件', () => {
    const poopTypes = [
        { id: 1, name: '第1型', emoji: '🫘' },
        { id: 4, name: '第4型', emoji: '🍌' }
    ];

    test('formatDuration 处理极大值', () => {
        expect(formatDuration(86400)).toBe('1440 分');
    });

    test('formatDuration 处理浮点数', () => {
        expect(formatDuration(45.9)).toBe('45 秒');
        expect(formatDuration(90.5)).toBe('1 分 30 秒');
    });

    test('buildTextFromRecords 处理非数组输入', () => {
        const text = api.buildTextFromRecords(null, { poopTypes });
        expect(text).toContain('共 0 条记录');
    });

    test('buildTextFromRecords 处理超大数组', () => {
        const records = Array(100).fill({ date: '2024-01-15', poopType: 4, duration: 300 });
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('共 100 条记录');
        expect(text).toContain('总次数: 100');
    });
});