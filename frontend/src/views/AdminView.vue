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

    <!-- 用户列表 -->
    <section class="panel">
      <h2 class="panel-title">👥 用户列表</h2>
      <div v-if="users.length === 0" class="empty-hint">暂无用户</div>
      <div class="user-grid">
        <div
          v-for="u in users"
          :key="u.id"
          class="user-card"
          :class="{ 'user-card--active': selectedUserId === u.id, 'user-card--admin': u.role === 'admin' }"
          @click="selectUser(u.id)"
        >
          <div class="user-card__header">
            <span class="user-card__name">{{ u.username }}</span>
            <span v-if="u.role === 'admin'" class="user-card__badge admin-badge">管理员</span>
          </div>
          <div class="user-card__email">{{ u.email }}</div>
          <div class="user-card__meta">
            <span>📋 {{ u.record_count }} 条记录</span>
            <span>📅 {{ formatDate(u.created_at) }}</span>
          </div>
          <button class="btn btn--small btn--reset" @click.stop="openResetPassword(u)">重置密码</button>
          <button v-if="u.role !== 'admin'" class="btn btn--small btn--danger" @click.stop="confirmDeleteUser(u)">删除</button>
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
      <div class="modal-content" @click.stop>
        <h3 class="modal-title">🔐 重置密码</h3>
        <p class="modal-subtitle">为用户 <strong>{{ resetPasswordUser.username }}</strong> 设置新密码</p>
        <div class="modal-field">
          <label>新密码（至少6位）</label>
          <input
            type="password"
            v-model="resetPasswordValue"
            placeholder="请输入新密码"
            class="input"
          />
        </div>
        <div v-if="resetPasswordError" class="modal-error">{{ resetPasswordError }}</div>
        <div v-if="resetPasswordSuccess" class="modal-success">{{ resetPasswordSuccess }}</div>
        <div class="modal-actions">
          <button class="btn btn--secondary" @click="closeResetPassword">取消</button>
          <button class="btn btn--primary" @click="handleResetPassword" :disabled="resetPasswordSaving">
            {{ resetPasswordSaving ? '重置中...' : '确认重置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除用户确认弹窗 -->
    <div v-if="deleteUserTarget" class="modal-overlay" @click="cancelDeleteUser">
      <div class="modal-content" @click.stop>
        <h3 class="modal-title">⚠️ 删除用户</h3>
        <p class="modal-subtitle">
          确定要删除用户 <strong>{{ deleteUserTarget.username }}</strong> 吗？<br>
          该操作将同时删除该用户的所有记录，且不可恢复！
        </p>
        <div v-if="deleteUserError" class="modal-error">{{ deleteUserError }}</div>
        <div class="modal-actions">
          <button class="btn btn--secondary" @click="cancelDeleteUser">取消</button>
          <button class="btn btn--danger" @click="handleDeleteUser" :disabled="deleteUserSaving">
            {{ deleteUserSaving ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 筛选控制 -->
    <section class="panel">
      <h2 class="panel-title">🔍 筛选记录</h2>
      <div class="filter-grid">
        <label class="field">
          <span>开始日期</span>
          <input type="date" v-model="filter.start" class="input" />
        </label>
        <label class="field">
          <span>结束日期</span>
          <input type="date" v-model="filter.end" class="input" />
        </label>
        <label class="field">
          <span>大便类型</span>
          <select v-model="filter.poop_type" class="input">
            <option value="">全部</option>
            <option v-for="pt in poopTypes" :key="pt.id" :value="pt.id">
              {{ pt.emoji }} {{ pt.name }}
            </option>
          </select>
        </label>
        <div class="filter-actions">
          <button class="btn btn--primary" @click="loadRecords">查询</button>
          <button class="btn btn--secondary" @click="resetFilter">重置</button>
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
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api, formatDuration } from '../services/api.js'

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
  color: #2d3748;
}

.panel {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.panel-title {
  font-size: 18px;
  margin: 0 0 20px 0;
  color: #2d3748;
}

.panel-subtitle {
  font-size: 13px;
  font-weight: normal;
  color: #718096;
  margin-left: 8px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  border-radius: 12px;
  padding: 20px;
  color: white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.gradient-1 { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
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
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.user-card {
  padding: 16px;
  border-radius: 10px;
  border: 2px solid transparent;
  background: #f7fafc;
  cursor: pointer;
  transition: all 0.2s;
}

.user-card:hover {
  background: #edf2f7;
  transform: translateY(-2px);
}

.user-card--active {
  border-color: #667eea;
  background: #ebf4ff;
}

.user-card--admin {
  background: linear-gradient(135deg, #fffbeb 0%, #fff5f5 100%);
}

.user-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.user-card__name {
  font-size: 16px;
  font-weight: 600;
  color: #2d3748;
}

.user-card__badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #f56565;
  color: white;
}

.user-card__email {
  font-size: 12px;
  color: #718096;
  margin-bottom: 8px;
}

.user-card__meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #a0aec0;
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
  color: #4a5568;
  font-weight: 500;
}

.input {
  padding: 8px 12px;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  font-size: 14px;
  background: white;
}

.input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.2);
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn--primary {
  background: #667eea;
  color: white;
}

.btn--primary:hover {
  background: #5a67d8;
}

.btn--secondary {
  background: #e2e8f0;
  color: #4a5568;
}

.btn--secondary:hover {
  background: #cbd5e0;
}

.btn--secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--danger {
  background: #f56565;
  color: white;
}

.btn--danger:hover {
  background: #e53e3e;
}

.btn--small {
  padding: 6px 12px;
  font-size: 12px;
}

.btn--active {
  background: #667eea;
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
  border-radius: 10px;
  background: #f7fafc;
  border-left: 4px solid #667eea;
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
  color: #2d3748;
}

.record-item__email {
  font-size: 12px;
  color: #a0aec0;
}

.record-item__date {
  font-size: 13px;
  color: #4a5568;
  margin-bottom: 6px;
}

.record-item__status,
.record-item__duration,
.record-item__notes {
  font-size: 12px;
  color: #718096;
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
  background: linear-gradient(90deg, #667eea, #764ba2);
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
}
</style>
