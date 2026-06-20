<template>
  <div class="admin-view">
    <h1 class="page-title">🛡  管理员面板</h1>

    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>

    <!-- 全局统计卡片 -->
    <div v-if="stats" class="summary-grid">
      <div class="summary-card gradient-1">
        <div class="summary-label">注册用户</div>
        <div class="summary-value">{{ stats.userCount }}</div>
      </div>
      <div class="summary-card gradient-2">
        <div class="summary-label">总记录数</div>
        <div class="summary-value">{{ stats.recordCount }}</div>
      </div>
      <div class="summary-card gradient-3">
        <div class="summary-label">今日新增</div>
        <div class="summary-value">{{ stats.todayCount }}</div>
      </div>
      <div class="summary-card gradient-4">
        <div class="summary-label">管理员</div>
        <div class="summary-value">{{ stats.adminCount }}</div>
      </div>
    </div>

    <!-- 标签页切换 -->
    <div class="tabs" role="tablist" aria-label="管理员面板">
      <button type="button" role="tab" :aria-selected="activeTab === 'users'" :tabindex="activeTab === 'users' ? 0 : -1" class="tab-btn" :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">👥 用户管理</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'loginLogs'" :tabindex="activeTab === 'loginLogs' ? 0 : -1" class="tab-btn" :class="{ active: activeTab === 'loginLogs' }" @click="switchToLoginLogs">📝 登录日志</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'auditLogs'" :tabindex="activeTab === 'auditLogs' ? 0 : -1" class="tab-btn" :class="{ active: activeTab === 'auditLogs' }" @click="switchToAuditLogs">🔍 审计日志</button>
    </div>

    <!-- 用户管理 -->
    <div v-show="activeTab === 'users'">
      <!-- 用户列表 -->
      <section class="panel">
        <h2 class="panel-title">👥 用户列表</h2>
        <div v-if="users.length === 0" class="empty-hint">暂无用户</div>
        <div class="user-grid">
          <div
            v-for="u in users"
            :key="u.id"
            class="user-card"
            :class="{ 'user-card--active': selectedUserId === u.id, 'user-card--admin': u.role === 'admin', 'user-card--disabled': u.enabled === 0 }"
            @click="selectUser(u.id)"
          >
            <div class="user-card__header">
              <span class="user-card__name">{{ u.username }}</span>
              <span v-if="u.role === 'admin'" class="user-card__badge admin-badge">管理员</span>
              <span v-else-if="u.enabled === 0" class="user-card__badge disabled-badge">已禁用</span>
            </div>
            <div class="user-card__email">{{ u.email }}</div>
            <div class="user-card__meta">
              <span>📋 {{ u.record_count }} 条记录</span>
              <span>📅 {{ formatDate(u.created_at) }}</span>
            </div>
            <div class="user-card__actions">
              <button class="btn btn--small btn--reset" @click.stop="openResetPassword(u)">重置密码</button>
              <button v-if="u.role !== 'admin'" class="btn btn--small" :class="u.enabled ? 'btn--warning' : 'btn--success'" @click.stop="toggleUser(u)">
                {{ u.enabled ? '禁用' : '启用' }}
              </button>
              <button v-if="u.role !== 'admin'" class="btn btn--small btn--danger" @click.stop="confirmDeleteUser(u)">删除</button>
            </div>
          </div>
        </div>
        <div class="filter-row">
          <button
            class="btn btn--secondary"
            :class="{ 'btn--active': selectedUserId === null }"
            @click="selectUser(null)"
          >
            显示全部用户记录
          </button>
        </div>
      </section>

    <!-- 重置密码弹窗 -->
    <div v-if="resetPasswordUser" class="modal-overlay" @click="closeResetPassword">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="reset-pwd-title" @click.stop>
        <h3 id="reset-pwd-title" class="modal-title">🔐 重置密码</h3>
        <p class="modal-subtitle">为用户 <strong>{{ resetPasswordUser.username }}</strong> 设置新密码</p>
        <div class="modal-field">
          <label for="reset-pwd-input">新密码（至少6位）</label>
          <input
            id="reset-pwd-input"
            type="password"
            v-model="resetPasswordValue"
            placeholder="请输入新密码"
            class="input"
            autocomplete="new-password"
            spellcheck="false"
          />
        </div>
        <div v-if="resetPasswordError" class="modal-error" role="alert">{{ resetPasswordError }}</div>
        <div v-if="resetPasswordSuccess" class="modal-success" role="status">{{ resetPasswordSuccess }}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" @click="closeResetPassword">取消</button>
          <button type="button" class="btn btn--primary" @click="handleResetPassword" :disabled="resetPasswordSaving">
            {{ resetPasswordSaving ? '重置中...' : '确认重置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除用户确认弹窗 -->
    <div v-if="deleteUserTarget" class="modal-overlay" @click="cancelDeleteUser">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="delete-user-title" @click.stop>
        <h3 id="delete-user-title" class="modal-title">⚠️ 删除用户</h3>
        <p class="modal-subtitle">
          确定要删除用户 <strong>{{ deleteUserTarget.username }}</strong> 吗？<br>
          该操作将同时删除该用户的所有记录，且不可恢复！
        </p>
        <div v-if="deleteUserError" class="modal-error" role="alert">{{ deleteUserError }}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" @click="cancelDeleteUser">取消</button>
          <button type="button" class="btn btn--danger" @click="handleDeleteUser" :disabled="deleteUserSaving">
            {{ deleteUserSaving ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 筛选控制 -->
    <section class="panel">
      <h2 class="panel-title">🔍 筛选记录</h2>
      <div class="filter-grid">
        <label class="field" for="filter-start">
          <span>开始日期</span>
          <input id="filter-start" type="date" v-model="filter.start" class="input" />
        </label>
        <label class="field" for="filter-end">
          <span>结束日期</span>
          <input id="filter-end" type="date" v-model="filter.end" class="input" />
        </label>
        <label class="field" for="filter-type">
          <span>大便类型</span>
          <select id="filter-type" v-model="filter.poop_type" class="input">
            <option value="">全部</option>
            <option v-for="pt in poopTypes" :key="pt.id" :value="pt.id">
              {{ pt.emoji }} {{ pt.name }}
            </option>
          </select>
        </label>
        <div class="filter-actions">
          <button type="button" class="btn btn--primary" @click="loadRecords">查询</button>
          <button type="button" class="btn btn--secondary" @click="resetFilter">重置</button>
        </div>
      </div>
    </section>

    <!-- 记录列表 -->
    <section class="panel">
      <h2 class="panel-title">
        📋 记录详情
        <span class="panel-subtitle">
          共 {{ recordsPage.total || 0 }} 条
          <span v-if="selectedUserId">（已筛选用户 ID: {{ selectedUserId }}）</span>
          · 平均时长: {{ formatDuration(recordsPage.avgDuration || 0) }}
          · 活跃用户: {{ recordsPage.userCount || 0 }}
        </span>
      </h2>

      <div v-if="recordsPage.records && recordsPage.records.length === 0" class="empty-hint">
        没有符合条件的记录
      </div>

      <div v-else class="records-list">
        <div v-for="r in recordsPage.records" :key="r.id" class="record-item">
          <div class="record-item__left">
            <div class="record-item__type">{{ getPoopTypeEmoji(r.poopType) }}</div>
            <div class="record-item__info">
              <div class="record-item__user">
                <span class="record-item__username">{{ r.username }}</span>
                <span class="record-item__email">{{ r.email }}</span>
              </div>
              <div class="record-item__date">{{ formatDateTime(r.date) }}</div>
              <div v-if="r.duration" class="record-item__duration">时长: {{ formatDuration(r.duration) }}</div>
            </div>
          </div>
          <div class="record-item__right">
            <button class="btn btn--danger btn--small" @click="deleteRecord(r.id)">删除</button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="recordsPage.page && recordsPage.page.total > recordsPage.page.limit" class="pagination">
        <button
          class="btn btn--secondary"
          :disabled="recordsPage.page.offset === 0"
          @click="changePage(-1)"
        >
          ← 上一页
        </button>
        <span class="pagination-info">
          {{ recordsPage.page.offset + 1 }} - {{ Math.min(recordsPage.page.offset + recordsPage.page.limit, recordsPage.page.total) }} / {{ recordsPage.page.total }}
        </span>
        <button
          class="btn btn--secondary"
          :disabled="recordsPage.page.offset + recordsPage.page.limit >= recordsPage.page.total"
          @click="changePage(1)"
        >
          下一页 →
        </button>
      </div>
    </section>

    <!-- 近 30 天趋势 -->
    <section v-if="stats && stats.trend" class="panel">
      <h2 class="panel-title">📊 近 30 天趋势</h2>
      <div class="trend-bars">
        <div v-for="t in [...stats.trend].reverse()" :key="t.day" class="trend-bar-row">
          <span class="trend-bar-day">{{ t.day }}</span>
          <div class="trend-bar-track">
            <div class="trend-bar-fill" :style="{ width: getTrendPercent(t.count) + '%' }"></div>
          </div>
          <span class="trend-bar-value">{{ t.count }} 条 · {{ t.users }} 人</span>
        </div>
      </div>
    </section>
    </div>

    <!-- 登录日志 -->
    <div v-show="activeTab === 'loginLogs'" class="panel">
      <h2 class="panel-title">📝 登录日志</h2>
      <div class="filter-grid">
        <label class="field" for="log-start">
          <span>开始日期</span>
          <input id="log-start" type="date" v-model="loginLogFilter.start" class="input" />
        </label>
        <label class="field" for="log-end">
          <span>结束日期</span>
          <input id="log-end" type="date" v-model="loginLogFilter.end" class="input" />
        </label>
        <label class="field" for="log-user">
          <span>用户</span>
          <select id="log-user" v-model="loginLogFilter.user_id" class="input">
            <option value="">全部</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
          </select>
        </label>
        <label class="field" for="log-success">
          <span>结果</span>
          <select id="log-success" v-model="loginLogFilter.success" class="input">
            <option value="">全部</option>
            <option value="1">成功</option>
            <option value="0">失败</option>
          </select>
        </label>
        <div class="filter-actions">
          <button type="button" class="btn btn--primary" @click="loadLoginLogs">查询</button>
          <button type="button" class="btn btn--secondary" @click="resetLoginLogFilter">重置</button>
        </div>
      </div>
      <div v-if="loginLogs.length === 0" class="empty-hint">暂无登录日志</div>
      <div v-else class="logs-list">
        <div v-for="log in loginLogs" :key="log.id" class="log-item" :class="{ 'log-item--failed': !log.success }">
          <div class="log-item__icon">{{ log.success ? '✅' : '❌' }}</div>
          <div class="log-item__info">
            <div class="log-item__user">
              <span class="log-item__username">{{ log.username || '未知用户' }}</span>
              <span class="log-item__email">{{ log.email || '-' }}</span>
            </div>
            <div class="log-item__detail">
              {{ log.deviceType }} · {{ log.deviceBrowser }} · {{ log.deviceOs }}
              <span v-if="log.deviceModel"> · {{ log.deviceModel }}</span>
              <span v-if="log.ip"> · IP: {{ log.ip }}</span>
            </div>
            <div v-if="log.failReason" class="log-item__fail">失败原因: {{ log.failReason }}</div>
          </div>
          <div class="log-item__time">{{ formatDateTime(log.createdAt) }}</div>
        </div>
      </div>
      <div v-if="loginLogPage.total > loginLogPage.limit" class="pagination">
        <button class="btn btn--secondary" :disabled="loginLogPage.offset === 0" @click="changeLoginLogPage(-1)">← 上一页</button>
        <span class="pagination-info">{{ loginLogPage.offset + 1 }} - {{ Math.min(loginLogPage.offset + loginLogPage.limit, loginLogPage.total) }} / {{ loginLogPage.total }}</span>
        <button class="btn btn--secondary" :disabled="loginLogPage.offset + loginLogPage.limit >= loginLogPage.total" @click="changeLoginLogPage(1)">下一页 →</button>
      </div>
    </div>

    <!-- 审计日志 -->
    <div v-show="activeTab === 'auditLogs'" class="panel">
      <h2 class="panel-title">🔍 审计日志</h2>
      <div class="filter-grid">
        <label class="field" for="audit-start">
          <span>开始日期</span>
          <input id="audit-start" type="date" v-model="auditLogFilter.start" class="input" />
        </label>
        <label class="field" for="audit-end">
          <span>结束日期</span>
          <input id="audit-end" type="date" v-model="auditLogFilter.end" class="input" />
        </label>
        <label class="field" for="audit-action">
          <span>操作类型</span>
          <select id="audit-action" v-model="auditLogFilter.action" class="input">
            <option value="">全部</option>
            <option value="RESET_PASSWORD">重置密码</option>
            <option value="DELETE_USER">删除用户</option>
            <option value="ENABLE_USER">启用用户</option>
            <option value="DISABLE_USER">禁用用户</option>
            <option value="DELETE_RECORD">删除记录</option>
          </select>
        </label>
        <label class="field" for="audit-target">
          <span>目标类型</span>
          <select id="audit-target" v-model="auditLogFilter.target_type" class="input">
            <option value="">全部</option>
            <option value="user">用户</option>
            <option value="record">记录</option>
          </select>
        </label>
        <div class="filter-actions">
          <button type="button" class="btn btn--primary" @click="loadAuditLogs">查询</button>
          <button type="button" class="btn btn--secondary" @click="resetAuditLogFilter">重置</button>
        </div>
      </div>
      <div v-if="auditLogs.length === 0" class="empty-hint">暂无审计日志</div>
      <div v-else class="logs-list">
        <div v-for="log in auditLogs" :key="log.id" class="log-item audit-log-item">
          <div class="log-item__icon">🔔</div>
          <div class="log-item__info">
            <div class="log-item__user">
              <span class="log-item__username">{{ log.adminUsername }}</span>
              <span class="log-item__action">{{ getActionLabel(log.action) }}</span>
            </div>
            <div class="log-item__detail" v-if="log.detail">{{ log.detail }}</div>
          </div>
          <div class="log-item__time">{{ formatDateTime(log.createdAt) }}</div>
        </div>
      </div>
      <div v-if="auditLogPage.total > auditLogPage.limit" class="pagination">
        <button class="btn btn--secondary" :disabled="auditLogPage.offset === 0" @click="changeAuditLogPage(-1)">← 上一页</button>
        <span class="pagination-info">{{ auditLogPage.offset + 1 }} - {{ Math.min(auditLogPage.offset + auditLogPage.limit, auditLogPage.total) }} / {{ auditLogPage.total }}</span>
        <button class="btn btn--secondary" :disabled="auditLogPage.offset + auditLogPage.limit >= auditLogPage.total" @click="changeAuditLogPage(1)">下一页 →</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, formatDuration } from '../services/api.js'

const route = useRoute()
const router = useRouter()

const VALID_TABS = ['users', 'loginLogs', 'auditLogs']
const activeTab = ref(route.query.tab && VALID_TABS.includes(route.query.tab) ? route.query.tab : 'users')

function syncTabToUrl(tab) {
  router.replace({ query: { ...route.query, tab } }).catch(() => {})
}

watch(activeTab, syncTabToUrl)

const POOP_TYPES = [
  { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球（很难排出）' },
  { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状' },
  { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状' },
  { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状' },
  { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状' },
  { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状，不成形' },
  { id: 7, name: '第7型', emoji: '💧', description: '水状，无固体成分' }
]

const errorMessage = ref('')
const users = ref([])
const stats = ref(null)
const selectedUserId = ref(null)
const recordsPage = reactive({
  records: [],
  total: 0,
  avgDuration: 0,
  userCount: 0,
  page: { limit: 50, offset: 0, total: 0 }
})
const filter = reactive({ start: '', end: '', poop_type: '' })

// 登录日志
const loginLogs = ref([])
const loginLogFilter = reactive({ start: '', end: '', user_id: '', success: '' })
const loginLogPage = reactive({ limit: 50, offset: 0, total: 0 })

// 审计日志
const auditLogs = ref([])
const auditLogFilter = reactive({ start: '', end: '', action: '', target_type: '' })
const auditLogPage = reactive({ limit: 50, offset: 0, total: 0 })

// 重置密码相关
const resetPasswordUser = ref(null)
const resetPasswordValue = ref('')
const resetPasswordError = ref('')
const resetPasswordSuccess = ref('')
const resetPasswordSaving = ref(false)

// 删除用户相关
const deleteUserTarget = ref(null)
const deleteUserError = ref('')
const deleteUserSaving = ref(false)

const poopTypes = POOP_TYPES

function getPoopTypeEmoji(id) {
  const t = POOP_TYPES.find(p => p.id === id)
  return t ? t.emoji : '❓'
}

function getTrendPercent(count) {
  if (!stats.value || !stats.value.trend) return 0
  const max = Math.max(...stats.value.trend.map(t => t.count), 1)
  return Math.round((count / max) * 100)
}

function formatDate(d) {
  if (!d) return '-'
  const date = new Date(d)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDateTime(d) {
  if (!d) return '-'
  const date = new Date(d)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${dd} ${hh}:${mm}`
}

async function loadStats() {
  try {
    stats.value = await api.adminGetStats()
  } catch (e) {
    errorMessage.value = e.message
  }
}

async function loadUsers() {
  try {
    const data = await api.adminGetUsers()
    users.value = data.users || []
  } catch (e) {
    errorMessage.value = e.message
  }
}

async function loadRecords() {
  try {
    const params = { limit: 50, offset: recordsPage.page.offset || 0 }
    if (selectedUserId.value) params.user_id = selectedUserId.value
    if (filter.start) params.start = filter.start
    if (filter.end) params.end = filter.end
    if (filter.poop_type) params.poop_type = filter.poop_type

    const data = await api.adminGetRecords(params)
    recordsPage.records = data.records || []
    recordsPage.total = data.total || 0
    recordsPage.avgDuration = data.avgDuration || 0
    recordsPage.userCount = data.userCount || 0
    if (data.page) recordsPage.page = data.page
  } catch (e) {
    errorMessage.value = e.message
  }
}

function selectUser(userId) {
  selectedUserId.value = userId
  recordsPage.page.offset = 0
  loadRecords()
}

function resetFilter() {
  filter.start = ''
  filter.end = ''
  filter.poop_type = ''
  selectedUserId.value = null
  recordsPage.page.offset = 0
  loadRecords()
}

function changePage(direction) {
  recordsPage.page.offset += direction * recordsPage.page.limit
  if (recordsPage.page.offset < 0) recordsPage.page.offset = 0
  loadRecords()
}

async function deleteRecord(id) {
  if (!confirm('确定要删除这条记录吗？')) return
  try {
    await api.adminDeleteRecord(id)
    loadRecords()
    loadStats()
  } catch (e) {
    errorMessage.value = e.message
  }
}

// 重置密码相关函数
function openResetPassword(user) {
  resetPasswordUser.value = user
  resetPasswordValue.value = ''
  resetPasswordError.value = ''
  resetPasswordSuccess.value = ''
}

function closeResetPassword() {
  resetPasswordUser.value = null
  resetPasswordValue.value = ''
  resetPasswordError.value = ''
  resetPasswordSuccess.value = ''
}

async function handleResetPassword() {
  if (!resetPasswordValue.value || resetPasswordValue.value.length < 6) {
    resetPasswordError.value = '密码至少6位'
    return
  }

  resetPasswordSaving.value = true
  resetPasswordError.value = ''
  resetPasswordSuccess.value = ''

  try {
    await api.adminResetUserPassword(resetPasswordUser.value.id, resetPasswordValue.value)
    resetPasswordSuccess.value = '密码已重置成功！'
    setTimeout(() => {
      closeResetPassword()
    }, 1500)
  } catch (e) {
    resetPasswordError.value = e.message || '重置失败'
  } finally {
    resetPasswordSaving.value = false
  }
}

// 删除用户相关函数
function confirmDeleteUser(user) {
  deleteUserTarget.value = user
  deleteUserError.value = ''
}

function cancelDeleteUser() {
  deleteUserTarget.value = null
  deleteUserError.value = ''
}

async function handleDeleteUser() {
  deleteUserSaving.value = true
  deleteUserError.value = ''

  try {
    await api.adminDeleteUser(deleteUserTarget.value.id)
    // 刷新用户列表和统计
    await Promise.all([loadUsers(), loadStats()])
    cancelDeleteUser()
  } catch (e) {
    deleteUserError.value = e.message || '删除失败'
  } finally {
    deleteUserSaving.value = false
  }
}

// 启用/禁用用户
async function toggleUser(user) {
  try {
    const result = await api.adminToggleUser(user.id)
    // 更新用户列表中的状态
    const idx = users.value.findIndex(u => u.id === user.id)
    if (idx !== -1) {
      users.value[idx].enabled = result.enabled
    }
  } catch (e) {
    errorMessage.value = e.message || '操作失败'
  }
}

// 登录日志
async function loadLoginLogs() {
  try {
    const params = { limit: loginLogPage.limit, offset: loginLogPage.offset }
    if (loginLogFilter.user_id) params.user_id = loginLogFilter.user_id
    if (loginLogFilter.success !== '') params.success = loginLogFilter.success
    if (loginLogFilter.start) params.start = loginLogFilter.start
    if (loginLogFilter.end) params.end = loginLogFilter.end
    const data = await api.adminGetLoginLogs(params)
    loginLogs.value = data.logs || []
    if (data.page) loginLogPage.total = data.page.total
  } catch (e) {
    errorMessage.value = e.message || '加载登录日志失败'
  }
}

function resetLoginLogFilter() {
  loginLogFilter.start = ''
  loginLogFilter.end = ''
  loginLogFilter.user_id = ''
  loginLogFilter.success = ''
  loginLogPage.offset = 0
  loadLoginLogs()
}

function changeLoginLogPage(dir) {
  loginLogPage.offset += dir * loginLogPage.limit
  if (loginLogPage.offset < 0) loginLogPage.offset = 0
  loadLoginLogs()
}

function switchToLoginLogs() {
  activeTab.value = 'loginLogs'
  if (loginLogs.value.length === 0) loadLoginLogs()
}

// 审计日志
async function loadAuditLogs() {
  try {
    const params = { limit: auditLogPage.limit, offset: auditLogPage.offset }
    if (auditLogFilter.action) params.action = auditLogFilter.action
    if (auditLogFilter.target_type) params.target_type = auditLogFilter.target_type
    if (auditLogFilter.start) params.start = auditLogFilter.start
    if (auditLogFilter.end) params.end = auditLogFilter.end
    const data = await api.adminGetAuditLogs(params)
    auditLogs.value = data.logs || []
    if (data.page) auditLogPage.total = data.page.total
  } catch (e) {
    errorMessage.value = e.message || '加载审计日志失败'
  }
}

function resetAuditLogFilter() {
  auditLogFilter.start = ''
  auditLogFilter.end = ''
  auditLogFilter.action = ''
  auditLogFilter.target_type = ''
  auditLogPage.offset = 0
  loadAuditLogs()
}

function changeAuditLogPage(dir) {
  auditLogPage.offset += dir * auditLogPage.limit
  if (auditLogPage.offset < 0) auditLogPage.offset = 0
  loadAuditLogs()
}

function switchToAuditLogs() {
  activeTab.value = 'auditLogs'
  if (auditLogs.value.length === 0) loadAuditLogs()
}

function getActionLabel(action) {
  const labels = {
    RESET_PASSWORD: '重置密码',
    DELETE_USER: '删除用户',
    ENABLE_USER: '启用用户',
    DISABLE_USER: '禁用用户',
    DELETE_RECORD: '删除记录'
  }
  return labels[action] || action
}

onMounted(async () => {
  await Promise.all([loadUsers(), loadStats()])
  await loadRecords()
})
</script>

<style scoped>
.admin-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.page-title {
  font-size: 28px;
  margin-bottom: 24px;
  text-align: center;
  color: var(--color-text);
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  background: var(--color-surface);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.tab-btn {
  padding: 8px 16px;
  border: none;
  background: var(--color-surface-2);
  color: var(--color-text-2);
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
}

.tab-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.tab-btn.active {
  background: var(--color-primary);
  color: white;
}

.tab-btn:hover:not(.active) {
  background: var(--color-border);
}

.panel {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.panel-title {
  font-size: 18px;
  margin: 0 0 20px 0;
  color: var(--color-text);
}

.panel-subtitle {
  font-size: 13px;
  font-weight: normal;
  color: var(--color-text-3);
  margin-left: 8px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  border-radius: var(--radius-md);
  padding: 20px;
  color: white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.gradient-1 { background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%); }
.gradient-2 { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.gradient-3 { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
.gradient-4 { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }

.summary-label {
  font-size: 14px;
  opacity: 0.9;
  margin-bottom: 8px;
}

.summary-value {
  font-size: 36px;
  font-weight: 700;
}

.user-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.user-card {
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 2px solid transparent;
  background: var(--color-surface-2);
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
}

.user-card:hover {
  background: var(--color-border);
  transform: translateY(-2px);
}

.user-card--active {
  border-color: var(--color-primary);
  background: var(--color-surface-2);
}

.user-card--admin {
  background: linear-gradient(135deg, #fffbeb 0%, #fff5f5 100%);
}

.user-card--disabled {
  opacity: 0.6;
}

.user-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
}

.user-card__name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.user-card__badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-danger);
  color: white;
  flex-shrink: 0;
}

.user-card__badge.admin-badge {
  background: var(--color-warning);
}

.user-card__badge.disabled-badge {
  background: var(--color-text-3);
}

.user-card__email {
  font-size: 12px;
  color: var(--color-text-3);
  margin-bottom: 8px;
}

.user-card__meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-4);
  margin-bottom: 8px;
}

.user-card__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.user-card__actions .btn {
  min-width: 80px;
  flex: 1;
  height: 34px;
  line-height: 34px;
  padding: 0 12px;
  font-size: 13px;
  margin: 0;
  border-radius: var(--radius-sm);
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.user-card__actions .btn:only-child {
  flex: none;
}

.filter-row {
  margin-top: 8px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: 13px;
  color: var(--color-text-2);
  font-weight: 500;
}

.input {
  height: 38px;
  line-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-sm);
  font-size: 14px;
  background: var(--color-surface);
  color: var(--color-text);
  box-sizing: border-box;
}

select.input {
  line-height: normal;
}

input[type="date"].input {
  line-height: normal;
}

.input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-soft);
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.btn {
  padding: 0 16px;
  height: 38px;
  line-height: 38px;
  border-radius: var(--radius-sm);
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn--primary {
  background: var(--color-primary);
  color: white;
}

.btn--primary:hover {
  background: var(--color-primary-dark);
}

.btn--secondary {
  background: var(--color-border);
  color: var(--color-text-2);
}

.btn--secondary:hover {
  background: var(--color-border-2);
}

.btn--secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--danger {
  background: var(--color-danger);
  color: white;
}

.btn--danger:hover {
  background: var(--color-danger-dark);
}

.btn--small {
  padding: 0 12px;
  height: 34px;
  line-height: 34px;
  font-size: 13px;
}

.btn--active {
  background: var(--color-primary);
  color: white;
}

.records-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.record-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  border-left: 4px solid var(--color-primary);
}

.record-item__left {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  flex: 1;
}

.record-item__type {
  font-size: 32px;
  line-height: 1;
}

.record-item__info {
  flex: 1;
}

.record-item__user {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.record-item__username {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.record-item__email {
  font-size: 12px;
  color: var(--color-text-4);
}

.record-item__date {
  font-size: 13px;
  color: var(--color-text-2);
  margin-bottom: 6px;
}

.record-item__status,
.record-item__duration,
.record-item__notes {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 3px;
}

.record-item__right {
  flex-shrink: 0;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 20px;
}

.pagination-info {
  font-size: 13px;
  color: #718096;
}

.trend-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trend-bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.trend-bar-day {
  width: 100px;
  color: #718096;
  flex-shrink: 0;
}

.trend-bar-track {
  flex: 1;
  height: 20px;
  background: #edf2f7;
  border-radius: 4px;
  overflow: hidden;
}

.trend-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-deep));
  border-radius: 4px;
  transition: width 0.3s;
}

.trend-bar-value {
  width: 100px;
  color: #4a5568;
  text-align: right;
  flex-shrink: 0;
}

.error-message {
  background: #fed7d7;
  color: #c53030;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
}

.empty-hint {
  padding: 32px;
  text-align: center;
  color: #a0aec0;
  font-size: 14px;
  background: #f7fafc;
  border-radius: 8px;
}

.btn--reset {
  margin-top: 10px;
  background: #ed8936;
  color: white;
  flex: 1;
}

.btn--reset:hover {
  background: #dd6b20;
}

.btn--danger {
  margin-top: 10px;
  margin-left: 8px;
  background: #e53e3e;
  color: white;
  flex: 1;
}

.btn--danger:hover {
  background: #c53030;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-title {
  font-size: 20px;
  margin: 0 0 12px 0;
  color: #2d3748;
}

.modal-subtitle {
  font-size: 14px;
  color: #718096;
  margin-bottom: 20px;
}

.modal-field {
  margin-bottom: 16px;
}

.modal-field label {
  display: block;
  font-size: 13px;
  color: #4a5568;
  margin-bottom: 6px;
}

.modal-error {
  background: #fed7d7;
  color: #c53030;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
}

.modal-success {
  background: #c6f6d5;
  color: #276749;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.modal-actions .btn {
  min-width: 100px;
  height: 36px;
  padding: 0 16px;
  margin: 0;
  flex: none;
}

@media (max-width: 600px) {
  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .summary-value {
    font-size: 28px;
  }
  .user-grid {
    grid-template-columns: 1fr;
  }
  .record-item {
    flex-direction: column;
    gap: 12px;
  }
  .trend-bar-day {
    width: 80px;
  }
  .trend-bar-value {
    width: 80px;
    font-size: 11px;
  }
  .tabs {
    flex-wrap: wrap;
  }
}

/* 日志列表 */
.logs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.log-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 10px;
  background: var(--color-surface-2);
  border-left: 4px solid var(--color-primary);
}

.log-item--failed {
  background: #fff5f5;
  border-left-color: #f56565;
}

.log-item__icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
}

.log-item__info {
  flex: 1;
  min-width: 0;
}

.log-item__user {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.log-item__username {
  font-size: 14px;
  font-weight: 600;
  color: #2d3748;
}

.log-item__email {
  font-size: 12px;
  color: #a0aec0;
}

.log-item__action {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #edf2f7;
  color: #4a5568;
}

.log-item__detail {
  font-size: 12px;
  color: #718096;
  word-break: break-all;
}

.log-item__fail {
  font-size: 12px;
  color: #c53030;
  margin-top: 4px;
}

.log-item__time {
  font-size: 12px;
  color: #a0aec0;
  flex-shrink: 0;
  white-space: nowrap;
}

/* 按钮颜色 */
.btn--warning {
  background: #ed8936;
  color: white;
}

.btn--warning:hover {
  background: #dd6b20;
}

.btn--success {
  background: #48bb78;
  color: white;
}

.btn--success:hover {
  background: #38a169;
}
</style>
