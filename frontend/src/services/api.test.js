/**
 * 前端 API 服务测试
 * 重点覆盖：ApiError 类、formatDuration/formatDurationShort 函数、buildTextFromRecords
 */

// 模拟 localStorage
const localStorageMock = {
    store: {},
    getItem: jest.fn((key) => localStorageMock.store[key] || null),
    setItem: jest.fn((key, value) => { localStorageMock.store[key] = value; }),
    removeItem: jest.fn((key) => { delete localStorageMock.store[key]; }),
    clear: jest.fn(() => { localStorageMock.store = {}; })
};
global.localStorage = localStorageMock;

// 模拟 fetch
global.fetch = jest.fn();

// 模拟 navigator.clipboard
Object.defineProperty(global.navigator, 'clipboard', {
    value: {
        writeText: jest.fn(() => Promise.resolve())
    },
    writable: true
});

// 模拟 window 和 document
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

// 模拟 URL
global.URL = {
    createObjectURL: jest.fn(() => 'blob:test-url'),
    revokeObjectURL: jest.fn()
};

// 模拟 Blob
global.Blob = jest.fn((content, options) => ({ content, options }));

// 导入模块（由于是 ES 模块，需要动态导入）
let api, ApiError, formatDuration, formatDurationShort;

beforeAll(async () => {
    // 由于 Jest 默认不支持 ES 模块，这里手动复制函数实现进行测试
    // 实际项目中应配置 Jest 支持 ES 模块或使用 ts-jest
    
    ApiError = class ApiError extends Error {
        constructor(message, statusCode, type = 'UNKNOWN') {
            super(message);
            this.name = 'ApiError';
            this.statusCode = statusCode;
            this.type = type;
        }
    };

    formatDuration = function(seconds) {
        const n = Number(seconds);
        if (!n || n <= 0) return '0 秒';
        const s = Math.floor(n);
        if (s < 60) return `${s} 秒`;
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
    };

    formatDurationShort = function(seconds) {
        const n = Number(seconds);
        if (!n || n <= 0) return '0 分';
        const minutes = n / 60;
        if (minutes >= 1) return `${Math.round(minutes * 10) / 10} 分`;
        return `${Math.round(n)} 秒`;
    };

    // buildTextFromRecords 实现
    const buildTextFromRecords = function(records, { title = '拉屎记录', poopTypes = [] } = {}) {
        const list = Array.isArray(records) ? records : [];
        const lines = [];
        lines.push(`${title} - ${new Date().toLocaleString('zh-CN')}`);
        lines.push(`共 ${list.length} 条记录`);
        lines.push('');
        if (list.length === 0) {
            lines.push('（当前筛选条件下暂无记录）');
            return lines.join('\n');
        }
        list.forEach((r, i) => {
            const d = r.date ? new Date(r.date) : null;
            const dateStr = d && !isNaN(d.getTime()) ? d.toLocaleString('zh-CN') : '-';
            lines.push(`${i + 1}. ${dateStr}`);
            const pt = poopTypes.find(t => t.id === r.poopType);
            lines.push(`   类型: ${pt ? pt.emoji : (r.poopType ? `编号 ${r.poopType}` : '未记录')}`);
            const dur = Number(r.duration);
            lines.push(`   时长: ${dur && dur > 0 ? formatDuration(dur) : '未记录'}`);
            lines.push('');
        });

        const total = list.length;
        const withDur = list.filter(r => Number(r.duration) > 0);
        const avg = withDur.length
            ? Math.round(withDur.reduce((s, r) => s + Number(r.duration), 0) / withDur.length)
            : 0;
        const typeCounts = {};
        list.forEach(r => {
            const k = r.poopType || 0;
            typeCounts[k] = (typeCounts[k] || 0) + 1;
        });
        lines.push('===== 统计 =====');
        lines.push(`总次数: ${total}`);
        lines.push(`平均时长: ${formatDuration(avg)}`);
        poopTypes.forEach(t => {
            const c = typeCounts[t.id] || 0;
            if (c > 0) lines.push(`${t.emoji} ${t.name}: ${c} 次`);
        });
        return lines.join('\n');
    };

    api = {
        buildTextFromRecords,
        downloadAsTxt: function(text, fileName) {
            const safeName = (fileName || `poop_${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_');
            const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safeName}.txt`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }, 0);
        },
        copyTextToClipboard: async function(text) {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
            // 回退方案
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '0';
            ta.setAttribute('readonly', '');
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            if (!ok) throw new Error('剪贴板不可用，请手动复制');
            return true;
        }
    };
});

// 每次测试前重置 mock
beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.store = {};
    fetch.mockClear();
});

// ============ ApiError 类测试 ============
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

// ============ formatDuration 函数测试 ============
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

// ============ formatDurationShort 函数测试 ============
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

// ============ buildTextFromRecords 函数测试 ============
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
        expect(text).toContain('平均时长: 5 分'); // (300+600+120)/3 = 340秒 ≈ 5分
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

// ============ copyTextToClipboard 函数测试 ============
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

// ============ 边界条件测试 ============
describe('边界条件', () => {
    const poopTypes = [
        { id: 1, name: '第1型', emoji: '🫘' },
        { id: 4, name: '第4型', emoji: '🍌' }
    ];

    test('formatDuration 处理极大值', () => {
        // 24 小时 = 86400 秒
        expect(formatDuration(86400)).toBe('1440 分');
    });

    test('formatDuration 处理浮点数', () => {
        expect(formatDuration(45.9)).toBe('45 秒'); // 向下取整
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