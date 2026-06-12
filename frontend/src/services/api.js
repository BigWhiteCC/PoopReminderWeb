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

      switch (res.status) {
        case 400:
          errorMessage = '请求参数错误'
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
          errorMessage = '服务器内部错误'
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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, email, password })
    })
  },

  async login(email, password) {
    return request(`${API_BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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

  async addRecord(notes = '') {
    return request(`${API_BASE}/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notes })
    })
  },

  async deleteRecord(id) {
    return request(`${API_BASE}/delete/${id}`, {
      method: 'DELETE'
    })
  },

  async updateSettings(hour, minute) {
    return request(`${API_BASE}/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ hour, minute })
    })
  }
}

export { ApiError }