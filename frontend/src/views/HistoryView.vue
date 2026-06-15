<template>
  <div class="history-view">
    <h1 class="page-title">📜 历史记录</h1>

    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>

    <!-- 筛选器 -->
    <div class="filter-card">
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
      </div>
      <div class="filter-actions">
        <button class="btn btn-outline" @click="resetFilter">重置</button>
        <button class="btn btn-primary" @click="loadData">查询</button>
      </div>
    </div>

    <!-- 概览统计 -->
    <div v-if="stats.total" class="stats-card">
      <div class="stat">
        <div class="stat-label">总次数</div>
        <div class="stat-value">{{ stats.total }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">平均时长</div>
        <div class="stat-value">{{ formatDuration(stats.avgDuration) }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">有记录天数</div>
        <div class="stat-value">{{ (stats.daily || []).length }}</div>
      </div>
    </div>

    <!-- 导出按钮 -->
    <div v-if="records.length > 0" class="export-row">
      <button class="btn btn-outline" @click="handleExportTxt">导出文本</button>
      <button class="btn btn-outline" @click="handleCopy">复制到剪贴板</button>
    </div>

    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>加载中...</p>
    </div>

    <div v-else-if="records.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p>暂无符合条件的记录</p>
    </div>

    <div v-else class="records-grid">
      <div v-for="record in records" :key="record.id" class="record-card">
        <div class="record-header">
          <div>
            <div class="record-date">{{ formatDate(record.date) }}</div>
            <div class="record-poop-type">
              {{ getPoopTypeEmoji(record.poopType) }}
              <span v-if="record.duration" class="record-duration"> · {{ formatDuration(record.duration) }}</span>
            </div>
          </div>
          <button class="delete-btn" @click="handleDelete(record.id)">删除</button>
        </div>
        <div v-if="record.device" class="record-device">
          📱 {{ record.device.model || record.device.type }} · {{ record.device.os }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { api, ApiError, formatDuration } from '../services/api'

const poopTypes = ref([])
const records = ref([])
const stats = ref({ total: 0, avgDuration: 0, daily: [] })
const loading = ref(true)
const errorMessage = ref('')
const filter = reactive({ start: '', end: '', poop_type: '' })

function showError(message) {
  errorMessage.value = message
  setTimeout(() => { errorMessage.value = '' }, 3500)
}

function getPoopTypeEmoji(id) {
  const pt = poopTypes.value.find(t => t.id === id)
  return pt ? pt.emoji : '💩'
}
function getPoopTypeName(id) {
  const pt = poopTypes.value.find(t => t.id === id)
  return pt ? pt.name : '未知类型'
}

async function loadData() {
  loading.value = true
  try {
    const data = await api.getRecords({
      start: filter.start || undefined,
      end: filter.end || undefined,
      poop_type: filter.poop_type || undefined
    })
    records.value = data.records || []
    stats.value = data.stats || { total: 0, avgDuration: 0, daily: [] }
  } catch (err) {
    if (err instanceof ApiError) showError(`加载失败: ${err.message}`)
    else showError('加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

function resetFilter() {
  filter.start = ''
  filter.end = ''
  filter.poop_type = ''
  loadData()
}

async function handleDelete(id) {
  if (!confirm('确定要删除这条记录吗？')) return
  try {
    await api.deleteRecord(id)
    await loadData()
  } catch (err) {
    if (err instanceof ApiError) showError(`删除失败: ${err.message}`)
    else showError('删除失败，请稍后重试')
  }
}

async function handleExportTxt() {
  try {
    const text = api.buildTextFromRecords(records.value, {
      title: '历史记录',
      poopTypes: poopTypes.value
    })
    const today = new Date()
    const pad = n => String(n).padStart(2, '0')
    const name = `history_${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`
    api.downloadAsTxt(text, name)
  } catch (err) { showError('导出失败') }
}

async function handleCopy() {
  try {
    const text = api.buildTextFromRecords(records.value, {
      title: '历史记录',
      poopTypes: poopTypes.value
    })
    await api.copyTextToClipboard(text)
    showSuccess('已复制到剪贴板')
  } catch (err) { showError('复制失败，请稍后重试') }
}

function showSuccess(msg) {
  const old = document.querySelector('.toast-success')
  if (old) old.remove()
  const el = document.createElement('div')
  el.className = 'toast-success'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el) }, 2200)
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit'
  })
}

onMounted(async () => {
  try {
    const typesData = await api.getPoopTypes()
    poopTypes.value = typesData.types
  } catch (e) { console.error(e) }
  loadData()
})
</script>

<style scoped>
.history-view { animation: fadeIn 0.5s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.page-title {
  font-size: 1.5rem; color: #1f2937;
  margin-bottom: 1rem; text-align: center; font-weight: 700;
}

.error-message {
  background: #fef2f2; color: #dc2626; padding: 0.85rem 1rem;
  border-radius: 12px; margin-bottom: 0.75rem; text-align: center;
  font-size: 0.95rem;
}

.filter-card {
  background: white; border-radius: 16px; padding: 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 1rem;
}

.filter-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;
}
.field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; color: #374151; font-weight: 500; }

.input {
  width: 100%; padding: 0.65rem 0.75rem; border: 2px solid #e5e7eb;
  border-radius: 10px; font-size: 0.95rem;
  -webkit-appearance: none; appearance: none; background: #fff;
}
.input:focus {
  outline: none; border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
}

.filter-actions {
  display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.75rem;
}

.btn {
  padding: 0.6rem 1rem; border-radius: 10px; font-size: 0.95rem;
  font-weight: 600; cursor: pointer; border: 2px solid transparent;
  transition: all 0.2s ease; min-height: 42px;
}
.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;
  box-shadow: 0 4px 15px rgba(102,126,234,0.3);
}
.btn-outline {
  background: white; color: #667eea; border-color: #cbd5e1;
}
.btn:active { transform: scale(0.97); }

.stats-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px; padding: 1rem; color: white;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;
  margin-bottom: 1rem; box-shadow: 0 4px 20px rgba(102,126,234,0.3);
}
.stat { text-align: center; }
.stat-label { font-size: 0.75rem; opacity: 0.9; }
.stat-value { font-size: 1.4rem; font-weight: 800; margin-top: 0.15rem; }

.export-row { display: flex; gap: 0.5rem; justify-content: flex-end; margin-bottom: 1rem; }

.loading { text-align: center; padding: 3rem 1rem; color: #6b7280; }
.spinner {
  width: 36px; height: 36px; border: 4px solid #e5e7eb; border-top-color: #667eea;
  border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 0.5rem;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  background: white; border-radius: 16px; padding: 3rem 1rem;
  text-align: center; color: #6b7280; box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
.empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }

.records-grid { display: grid; gap: 0.75rem; }

.record-card {
  background: white; border-radius: 14px; padding: 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}
.record-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem; }
.record-date { color: #667eea; font-weight: 600; font-size: 0.95rem; }
.record-poop-type { color: #4c1d95; font-size: 0.9rem; font-weight: 600; margin-top: 0.15rem; }
.record-duration { color: #6b7280; font-weight: 500; }
.record-status { color: #374151; font-size: 0.85rem; margin-top: 0.3rem; }
.record-notes { color: #374151; font-size: 0.9rem; margin-top: 0.3rem; }
.record-device { color: #9ca3af; font-size: 0.75rem; margin-top: 0.3rem; }

.delete-btn {
  background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;
  padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.8rem;
  font-weight: 600; cursor: pointer; white-space: nowrap;
}
.delete-btn:active { background: #fee2e2; transform: scale(0.97); }

@media (max-width: 600px) {
  .filter-grid { grid-template-columns: 1fr 1fr; }
  .stats-card { grid-template-columns: repeat(3, 1fr); padding: 0.85rem; }
  .stat-value { font-size: 1.2rem; }
}
@media (max-width: 420px) {
  .filter-grid { grid-template-columns: 1fr; }
}
</style>
