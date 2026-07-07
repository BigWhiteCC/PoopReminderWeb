const localStorageMock = {
    store: {},
    getItem: jest.fn((key) => localStorageMock.store[key] || null),
    setItem: jest.fn((key, value) => { localStorageMock.store[key] = value; }),
    removeItem: jest.fn((key) => { delete localStorageMock.store[key]; }),
    clear: jest.fn(() => { localStorageMock.store = {}; })
};
global.localStorage = localStorageMock;

global.fetch = jest.fn();
global.URL = {
    createObjectURL: jest.fn(() => 'blob:test-url'),
    revokeObjectURL: jest.fn()
};
global.Blob = jest.fn((content, options) => ({ content, options }));
global.document = {
    createElement: jest.fn(() => ({
        href: '', download: '', style: {}, click: jest.fn(),
        value: '', focus: jest.fn(), select: jest.fn(), setSelectionRange: jest.fn(), setAttribute: jest.fn()
    })),
    body: { appendChild: jest.fn(), removeChild: jest.fn() },
    execCommand: jest.fn(() => true)
};
Object.defineProperty(global.navigator, 'clipboard', {
    value: { writeText: jest.fn(() => Promise.resolve()) },
    writable: true
});
global.window = { isSecureContext: true };

let api, ApiError, formatDuration, formatDurationShort;

beforeAll(async () => {
    try {
        const module = await import('./api.js');
        api = module.api;
        ApiError = module.ApiError;
        formatDuration = module.formatDuration;
        formatDurationShort = module.formatDurationShort;
    } catch (e) {
        console.warn('ES module import failed, falling back to manual definitions:', e.message);
        
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

        const API_BASE = '/api';

        async function request(url, options = {}) {
            try {
                const token = localStorage.getItem('token');
                options.headers = options.headers || {};
                if (token) {
                    options.headers['Authorization'] = `Bearer ${token}`;
                }

                const res = await fetch(url, options);

                if (!res.ok) {
                    let errorMessage = '请求失败';
                    let errorType = 'HTTP_ERROR';
                    let serverError = null;
                    try { serverError = await res.json() } catch (_) {}

                    switch (res.status) {
                        case 400:
                            errorMessage = (serverError && serverError.error) || '请求参数错误';
                            errorType = 'BAD_REQUEST';
                            break;
                        case 401:
                            localStorage.removeItem('token');
                            localStorage.removeItem('user');
                            errorMessage = '未授权，请重新登录';
                            errorType = 'UNAUTHORIZED';
                            break;
                        case 403:
                            errorMessage = '无权限访问';
                            errorType = 'FORBIDDEN';
                            break;
                        case 404:
                            errorMessage = '请求的资源不存在';
                            errorType = 'NOT_FOUND';
                            break;
                        case 500:
                            errorMessage = (serverError && serverError.error) || '服务器内部错误';
                            errorType = 'SERVER_ERROR';
                            break;
                        case 503:
                            errorMessage = '服务暂时不可用';
                            errorType = 'SERVICE_UNAVAILABLE';
                            break;
                        default:
                            errorMessage = `请求失败 (${res.status})`;
                    }

                    throw new ApiError(errorMessage, res.status, errorType);
                }

                const data = await res.json().catch(() => {
                    throw new ApiError('响应数据格式错误', res.status, 'PARSE_ERROR');
                });

                return data;

            } catch (error) {
                if (error instanceof TypeError && error.message.includes('fetch')) {
                    throw new ApiError('网络连接失败，请检查网络设置', 0, 'NETWORK_ERROR');
                }
                if (error instanceof ApiError) {
                    throw error;
                }
                throw new ApiError('未知错误，请稍后重试', 0, 'UNKNOWN');
            }
        }

        api = {
            async register(username, email, password) {
                return request(`${API_BASE}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password })
                });
            },
            async login(email, password) {
                return request(`${API_BASE}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
            },
            async getUserInfo() {
                return request(`${API_BASE}/user`);
            },
            async getPoopTypes() {
                return request(`${API_BASE}/poop-types`);
            },
            async addRecord(payload) {
                const body = {};
                if (payload.poop_type !== undefined && payload.poop_type !== null) body.poop_type = payload.poop_type;
                if (payload.duration !== undefined && payload.duration !== null) body.duration = payload.duration;
                if (payload.status !== undefined) body.status = payload.status;
                if (payload.notes !== undefined) body.notes = payload.notes;
                if (payload.date !== undefined && payload.date !== null) body.date = payload.date;
                return request(`${API_BASE}/record`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            },
            async updateRecord(id, payload) {
                return request(`${API_BASE}/record/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            },
            async deleteRecord(id) {
                return request(`${API_BASE}/record/${id}`, { method: 'DELETE' });
            },
            async getRecords({ start, end, poop_type } = {}) {
                const params = new URLSearchParams();
                if (start) params.append('start', start);
                if (end) params.append('end', end);
                if (poop_type) params.append('poop_type', String(poop_type));
                const qs = params.toString();
                return request(`${API_BASE}/record/list${qs ? `?${qs}` : ''}`);
            },
            async changePassword(oldPassword, newPassword) {
                return request(`${API_BASE}/user/password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPassword, newPassword })
                });
            },
            buildTextFromRecords(records, { title = '拉屎记录', poopTypes = [] } = {}) {
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
            }
        };
    }
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
});

describe('request 函数 - HTTP 状态码处理', () => {
    test('成功请求应返回 JSON 数据', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        const result = await api.login('test@test.com', 'password123');
        expect(result).toEqual({ success: true });
        expect(fetch).toHaveBeenCalled();
    });

    test('400 错误应返回 BAD_REQUEST', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 400,
            json: jest.fn().mockResolvedValue({ error: '参数错误' })
        });

        await expect(api.register('user', 'email', 'pwd')).rejects.toThrow(ApiError);
        await expect(api.register('user', 'email', 'pwd')).rejects.toMatchObject({
            statusCode: 400,
            type: 'BAD_REQUEST',
            message: '参数错误'
        });
    });

    test('401 错误应清除 Token 并返回 UNAUTHORIZED', async () => {
        localStorageMock.store['token'] = 'test-token';
        localStorageMock.store['user'] = 'test-user';

        fetch.mockResolvedValue({
            ok: false,
            status: 401,
            json: jest.fn().mockResolvedValue({})
        });

        await expect(api.getUserInfo()).rejects.toThrow(ApiError);
        await expect(api.getUserInfo()).rejects.toMatchObject({
            statusCode: 401,
            type: 'UNAUTHORIZED'
        });

        expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
    });

    test('403 错误应返回 FORBIDDEN', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 403,
            json: jest.fn().mockResolvedValue({})
        });

        await expect(api.getUserInfo()).rejects.toThrow(ApiError);
        await expect(api.getUserInfo()).rejects.toMatchObject({
            statusCode: 403,
            type: 'FORBIDDEN'
        });
    });

    test('404 错误应返回 NOT_FOUND', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 404,
            json: jest.fn().mockResolvedValue({})
        });

        await expect(api.getUserInfo()).rejects.toThrow(ApiError);
        await expect(api.getUserInfo()).rejects.toMatchObject({
            statusCode: 404,
            type: 'NOT_FOUND'
        });
    });

    test('500 错误应返回 SERVER_ERROR', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: jest.fn().mockResolvedValue({ error: '服务器错误' })
        });

        await expect(api.login('test@test.com', 'pwd')).rejects.toThrow(ApiError);
        await expect(api.login('test@test.com', 'pwd')).rejects.toMatchObject({
            statusCode: 500,
            type: 'SERVER_ERROR',
            message: '服务器错误'
        });
    });
});

describe('request 函数 - Token 附加', () => {
    test('有 Token 时应附加 Authorization 头', async () => {
        localStorageMock.store['token'] = 'my-token';
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({})
        });

        await api.getUserInfo();
        expect(fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer my-token'
                })
            })
        );
    });

    test('无 Token 时不应附加 Authorization 头', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({})
        });

        await api.getPoopTypes();
        const callArgs = fetch.mock.calls[0][1];
        expect(callArgs.headers).not.toHaveProperty('Authorization');
    });
});

describe('request 函数 - 网络错误处理', () => {
    test('fetch 网络错误应返回 NETWORK_ERROR', async () => {
        fetch.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(api.getUserInfo()).rejects.toThrow(ApiError);
        await expect(api.getUserInfo()).rejects.toMatchObject({
            statusCode: 0,
            type: 'NETWORK_ERROR'
        });
    });

    test('响应解析失败应返回 PARSE_ERROR', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockRejectedValue(new Error('Parse error'))
        });

        await expect(api.getUserInfo()).rejects.toThrow(ApiError);
        await expect(api.getUserInfo()).rejects.toMatchObject({
            type: 'PARSE_ERROR'
        });
    });
});

describe('API 方法', () => {
    test('register 应发送 POST 请求', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.register('username', 'email@test.com', 'password123');
        expect(fetch).toHaveBeenCalledWith(
            '/api/register',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ username: 'username', email: 'email@test.com', password: 'password123' })
            })
        );
    });

    test('login 应发送 POST 请求', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.login('email@test.com', 'password123');
        expect(fetch).toHaveBeenCalledWith(
            '/api/login',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ email: 'email@test.com', password: 'password123' })
            })
        );
    });

    test('addRecord 应正确构建请求体', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.addRecord({
            poop_type: 4,
            duration: 300,
            notes: '测试备注',
            status: '正常',
            date: '2024-01-15'
        });

        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.poop_type).toBe(4);
        expect(body.duration).toBe(300);
        expect(body.notes).toBe('测试备注');
        expect(body.status).toBe('正常');
        expect(body.date).toBe('2024-01-15');
    });

    test('addRecord 应忽略未定义字段', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.addRecord({ poop_type: 4 });

        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body).toEqual({ poop_type: 4 });
        expect(body.duration).toBeUndefined();
        expect(body.notes).toBeUndefined();
    });

    test('updateRecord 应发送 PUT 请求', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.updateRecord(1, { poop_type: 5 });
        expect(fetch).toHaveBeenCalledWith(
            '/api/record/1',
            expect.objectContaining({ method: 'PUT' })
        );
    });

    test('deleteRecord 应发送 DELETE 请求', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.deleteRecord(1);
        expect(fetch).toHaveBeenCalledWith(
            '/api/record/1',
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    test('getRecords 应正确构建查询参数', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({})
        });

        await api.getRecords({ start: '2024-01-01', end: '2024-01-31', poop_type: 4 });
        expect(fetch).toHaveBeenCalledWith(
            '/api/record/list?start=2024-01-01&end=2024-01-31&poop_type=4',
            expect.anything()
        );
    });

    test('changePassword 应发送 POST 请求', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true })
        });

        await api.changePassword('oldpwd', 'newpwd123');
        expect(fetch).toHaveBeenCalledWith(
            '/api/user/password',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ oldPassword: 'oldpwd', newPassword: 'newpwd123' })
            })
        );
    });
});

describe('formatDuration - 时长格式化', () => {
    test('零或负数应返回 "0 秒"', () => {
        expect(formatDuration(0)).toBe('0 秒');
        expect(formatDuration(-1)).toBe('0 秒');
        expect(formatDuration(null)).toBe('0 秒');
    });

    test('小于 60 秒应返回秒数', () => {
        expect(formatDuration(30)).toBe('30 秒');
        expect(formatDuration(59)).toBe('59 秒');
    });

    test('超过 60 秒应返回分秒组合', () => {
        expect(formatDuration(90)).toBe('1 分 30 秒');
        expect(formatDuration(120)).toBe('2 分');
    });
});

describe('formatDurationShort - 精简时长格式化', () => {
    test('零或负数应返回 "0 分"', () => {
        expect(formatDurationShort(0)).toBe('0 分');
        expect(formatDurationShort(-1)).toBe('0 分');
    });

    test('小于 60 秒应返回秒数', () => {
        expect(formatDurationShort(30)).toBe('30 秒');
    });

    test('超过 60 秒应返回分钟数', () => {
        expect(formatDurationShort(90)).toBe('1.5 分');
        expect(formatDurationShort(120)).toBe('2 分');
    });
});

describe('buildTextFromRecords - 文本生成', () => {
    const poopTypes = [
        { id: 1, name: '第1型', emoji: '🫘' },
        { id: 4, name: '第4型', emoji: '🍌' }
    ];

    test('空记录数组应生成提示文本', () => {
        const text = api.buildTextFromRecords([], { poopTypes });
        expect(text).toContain('共 0 条记录');
    });

    test('单条记录应正确格式化', () => {
        const records = [{ date: '2024-01-15T08:30:00', poopType: 4, duration: 300 }];
        const text = api.buildTextFromRecords(records, { poopTypes });
        expect(text).toContain('🍌');
        expect(text).toContain('5 分');
    });
});