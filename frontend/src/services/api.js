const API_BASE = '/api'

class ApiError extends Error {
  constructor(message, statusCode, type = 'UNKNOWN') {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.type = type
  }
}

async function request(url, options = {}) {
  try {
    const token = localStorage.getItem('token')
    options.headers = options.headers || {}
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`
    }

    const res = await fetch(url, options)

    if (!res.ok) {
      let errorMessage = '请求失败'
      let errorType = 'HTTP_ERROR'

      // 优先读取服务端返回的错误提示
      let serverError = null
      try { serverError = await res.json() } catch (_) {}

      switch (res.status) {
        case 400:
          errorMessage = (serverError && serverError.error) || '请求参数错误'
          errorType = 'BAD_REQUEST'
          break
        case 401:
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          errorMessage = '未授权，请重新登录'
          errorType = 'UNAUTHORIZED'
          break
        case 403:
          errorMessage = '无权限访问'
          errorType = 'FORBIDDEN'
          break
        case 404:
          errorMessage = '请求的资源不存在'
          errorType = 'NOT_FOUND'
          break
        case 500:
          errorMessage = (serverError && serverError.error) || '服务器内部错误'
          errorType = 'SERVER_ERROR'
          break
        case 503:
          errorMessage = '服务暂时不可用'
          errorType = 'SERVICE_UNAVAILABLE'
          break
        default:
          errorMessage = `请求失败 (${res.status})`
      }

      throw new ApiError(errorMessage, res.status, errorType)
    }

    const data = await res.json().catch(() => {
      throw new ApiError('响应数据格式错误', res.status, 'PARSE_ERROR')
    })

    return data

  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiError('网络连接失败，请检查网络设置', 0, 'NETWORK_ERROR')
    }

    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError('未知错误，请稍后重试', 0, 'UNKNOWN')
  }
}

export const api = {
  async register(username, email, password) {
    return request(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    })
  },

  async login(email, password) {
    return request(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
  },

  async getUserInfo() {
    return request(`${API_BASE}/user`)
  },

  async getHomeData() {
    return request(`${API_BASE}/home`)
  },

  async getHistory() {
    return request(`${API_BASE}/history`)
  },

  async getSettings() {
    return request(`${API_BASE}/settings`)
  },

  async getPoopTypes() {
    return request(`${API_BASE}/poop-types`)
  },

  // 新增：完整的记录信息（类型/时长/状态/备注）
  async addRecord(payload) {
    const body = {}
    if (payload.poop_type !== undefined && payload.poop_type !== null) body.poop_type = payload.poop_type
    if (payload.duration !== undefined && payload.duration !== null) body.duration = payload.duration
    if (payload.status !== undefined) body.status = payload.status
    if (payload.notes !== undefined) body.notes = payload.notes
    if (payload.date !== undefined && payload.date !== null) body.date = payload.date
    return request(`${API_BASE}/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  },

  async updateRecord(id, payload) {
    return request(`${API_BASE}/record/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  },

  async deleteRecord(id) {
    return request(`${API_BASE}/delete/${id}`, { method: 'DELETE' })
  },

  async getRecords({ start, end, poop_type } = {}) {
    const params = new URLSearchParams()
    if (start) params.append('start', start)
    if (end) params.append('end', end)
    if (poop_type) params.append('poop_type', String(poop_type))
    const qs = params.toString()
    return request(`${API_BASE}/records${qs ? `?${qs}` : ''}`)
  },

  async getWeekly({ date, poop_type } = {}) {
    const params = new URLSearchParams()
    if (date) params.append('date', date)
    if (poop_type) params.append('poop_type', String(poop_type))
    const qs = params.toString()
    return request(`${API_BASE}/weekly${qs ? `?${qs}` : ''}`)
  },

  async getMonthly({ date, poop_type } = {}) {
    const params = new URLSearchParams()
    if (date) params.append('date', date)
    if (poop_type) params.append('poop_type', String(poop_type))
    const qs = params.toString()
    return request(`${API_BASE}/monthly${qs ? `?${qs}` : ''}`)
  },

  // 导出：直接返回 Blob 下载（绕过通用 request，因为响应不是 JSON）
  async exportRecords({ range, format, start, end, poop_type } = {}) {
    const token = localStorage.getItem('token')
    const params = new URLSearchParams()
    if (range) params.append('range', range)
    if (format) params.append('format', format)
    if (start) params.append('start', start)
    if (end) params.append('end', end)
    if (poop_type) params.append('poop_type', String(poop_type))

    const url = `${API_BASE}/export?${params.toString()}`
    const res = await fetch(url, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
    if (!res.ok) throw new ApiError('导出失败', res.status)
    const blob = await res.blob()
    // 从 Content-Disposition 获取文件名
    const cd = res.headers.get('Content-Disposition') || ''
    const match = cd.match(/filename="?([^";]+)"?/)
    const fileName = match ? match[1] : `poop_${Date.now()}.${format === 'txt' ? 'txt' : 'csv'}`
    return { blob, fileName }
  },

  // ======== 前端本地生成文本 + 下载/复制（替代 CSV，所有页面统一调用） ========
  // 把记录数组格式化为可读文本（中文、换行、表情）
  buildTextFromRecords(records, { title = '拉屎记录', poopTypes = [] } = {}) {
    const list = Array.isArray(records) ? records : []
    const lines = []
    lines.push(`${title} - ${new Date().toLocaleString('zh-CN')}`)
    lines.push(`共 ${list.length} 条记录`)
    lines.push('')
    if (list.length === 0) {
      lines.push('（当前筛选条件下暂无记录）')
      return lines.join('\n')
    }
    list.forEach((r, i) => {
      const d = r.date ? new Date(r.date) : null
      const dateStr = d && !isNaN(d.getTime()) ? d.toLocaleString('zh-CN') : '-'
      lines.push(`${i + 1}. ${dateStr}`)
      const pt = poopTypes.find(t => t.id === r.poopType)
      lines.push(`   类型: ${pt ? pt.emoji : (r.poopType ? `编号 ${r.poopType}` : '未记录')}`)
      const dur = Number(r.duration)
      lines.push(`   时长: ${dur && dur > 0 ? formatDuration(dur) : '未记录'}`)
      lines.push('')
    })

    // 附加简要统计
    const total = list.length
    const withDur = list.filter(r => Number(r.duration) > 0)
    const avg = withDur.length
      ? Math.round(withDur.reduce((s, r) => s + Number(r.duration), 0) / withDur.length)
      : 0
    const typeCounts = {}
    list.forEach(r => {
      const k = r.poopType || 0
      typeCounts[k] = (typeCounts[k] || 0) + 1
    })
    lines.push('===== 统计 =====')
    lines.push(`总次数: ${total}`)
    lines.push(`平均时长: ${formatDuration(avg)}`)
    poopTypes.forEach(t => {
      const c = typeCounts[t.id] || 0
      if (c > 0) lines.push(`${t.emoji} ${t.name}: ${c} 次`)
    })
    return lines.join('\n')
  },

  // 触发浏览器下载一个 .txt 文件
  downloadAsTxt(text, fileName) {
    const safeName = (fileName || `poop_${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_')
    // 加 BOM，记事本打开中文不乱码
    const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.txt`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      document.body.removeChild(a)
    }, 0)
  },

  // 写剪贴板；优先用 navigator.clipboard，不支持时回退到 textarea
  async copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    // 回退方案
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    ta.setAttribute('readonly', '')
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    let ok = false
    try { ok = document.execCommand('copy') } catch (e) { ok = false }
    document.body.removeChild(ta)
    if (!ok) throw new Error('剪贴板不可用，请手动复制')
    return true
  },

  async updateSettings(hour, minute) {
    return request(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hour, minute })
    })
  },

  // -------- 管理员 API --------
  async adminGetUsers() {
    return request(`${API_BASE}/admin/users`)
  },

  async adminGetRecords({ user_id, start, end, poop_type, limit, offset } = {}) {
    const params = new URLSearchParams()
    if (user_id) params.append('user_id', user_id)
    if (start) params.append('start', start)
    if (end) params.append('end', end)
    if (poop_type) params.append('poop_type', String(poop_type))
    if (limit !== undefined) params.append('limit', String(limit))
    if (offset !== undefined) params.append('offset', String(offset))
    const qs = params.toString()
    return request(`${API_BASE}/admin/records${qs ? `?${qs}` : ''}`)
  },

  async adminGetStats() {
    return request(`${API_BASE}/admin/stats`)
  },

  async adminDeleteRecord(id) {
    return request(`${API_BASE}/admin/record/${id}`, { method: 'DELETE' })
  }
}

// 把秒数格式化成人类可读的「X分Y秒」形式
function formatDuration(seconds) {
  const n = Number(seconds);
  if (!n || n <= 0) return '0 秒';
  const s = Math.floor(n);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分`;
}

// 把秒数格式化成精简展示，用于图表/头部统计卡（保留一位小数）
function formatDurationShort(seconds) {
  const n = Number(seconds);
  if (!n || n <= 0) return '0 分';
  const minutes = n / 60;
  if (minutes >= 1) return `${Math.round(minutes * 10) / 10} 分`;
  return `${Math.round(n)} 秒`;
}

export { ApiError, formatDuration, formatDurationShort };
