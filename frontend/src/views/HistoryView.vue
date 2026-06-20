<template>
  <div class="history-view">
    <h1 class="page-title">📜 历史记录</h1>

    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>

    <!-- 筛选器 -->
    <div class="filter-card">
      <div class="filter-grid">
        <label class="field" for="history-start">
          <span>开始日期</span>
          <input id="history-start" type="date" v-model="filter.start" class="input" />
        </label>
        <label class="field" for="history-end">
          <span>结束日期</span>
          <input id="history-end" type="date" v-model="filter.end" class="input" />
        </label>
        <label class="field" for="history-type">
          <span>大便类型</span>
          <select id="history-type" v-model="filter.poop_type" class="input">
            <option value="">全部</option>
            <option v-for="pt in poopTypes" :key="pt.id" :value="pt.id">
              {{ pt.emoji }} {{ pt.name }}
            </option>
          </select>
        </label>
      </div>
      <div class="filter-actions">
        <button type="button" class="btn btn-outline" @click="resetFilter">重置</button>
        <button type="button" class="btn btn-primary" @click="loadData">查询</button>
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
              {{ getPoopTypeEmoji(record.poopType) }} {{ getPoopTypeName(record.poopType) }}
              <span v-if="getPoopTypeCategory(record.poopType)" class="record-category">（{{ getPoopTypeCategory(record.poopType) }}）</span>
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
function getPoopTypeCategory(id) {
  const pt = poopTypes.value.find(t => t.id === id)
  return pt ? pt.category : ''
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
  font-size: 1.5rem; color: var(--color-text);
  margin-bottom: 1rem; text-align: center; font-weight: 700;
}

.error-message {
  background: var(--color-danger-soft); color: var(--color-danger-dark); padding: 0.85rem 1rem;
  border-radius: var(--radius-md); margin-bottom: 0.75rem; text-align: center;
  font-size: 0.95rem;
}

.filter-card {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 1rem;
  box-shadow: var(--shadow-sm); margin-bottom: 1rem;
}

.filter-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;
}
.field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; color: var(--color-text-2); font-weight: 500; }

.input {
  width: 100%; padding: 0.65rem 0.75rem; border: 2px solid var(--color-border);
  border-radius: var(--radius-md); font-size: 0.95rem;
  -webkit-appearance: none; appearance: none; background: var(--color-surface);
  color: var(--color-text);
  transition: border-color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  min-height: 44px; /* 日期选择框 placeholder/选中态高度一致 */
  box-sizing: border-box;
}
.input:focus {
  outline: none; border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
}

.filter-actions {
  display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.75rem;
}

.btn {
  padding: 0.6rem 1rem; border-radius: var(--radius-md); font-size: 0.95rem;
  font-weight: 600; cursor: pointer; border: 2px solid transparent;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease, box-shadow 0.15s var(--ease-default);
  min-height: 42px;
}
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn-primary {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%); color: white;
  box-shadow: var(--shadow-primary);
}
.btn-outline {
  background: var(--color-surface); color: var(--color-primary); border-color: var(--color-border-2);
}
.btn:active { transform: scale(0.97); }

.stats-card {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  border-radius: var(--radius-xl); padding: 1rem; color: white;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;
  margin-bottom: 1rem; box-shadow: var(--shadow-primary);
}
.stat { text-align: center; }
.stat-label { font-size: 0.75rem; opacity: 0.9; }
.stat-value { font-size: 1.4rem; font-weight: 800; margin-top: 0.15rem; }

.export-row { display: flex; gap: 0.5rem; justify-content: flex-end; margin-bottom: 1rem; }

.loading { text-align: center; padding: 3rem 1rem; color: var(--color-text-3); }
.spinner {
  width: 36px; height: 36px; border: 4px solid var(--color-border); border-top-color: var(--color-primary);
  border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 0.5rem;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 3rem 1rem;
  text-align: center; color: var(--color-text-3); box-shadow: var(--shadow-sm);
}
.empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }

.records-grid { display: grid; gap: 0.75rem; }

.record-card {
  background: var(--color-surface); border-radius: var(--radius-lg); padding: 1rem;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.15s var(--ease-default);
}
.record-card:hover { box-shadow: var(--shadow-md); }
.record-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem; }
.record-date { color: var(--color-primary); font-weight: 600; font-size: 0.95rem; }
.record-poop-type { color: var(--color-primary-dark); font-size: 0.9rem; font-weight: 600; margin-top: 0.15rem; }
.record-category { color: var(--color-text-3); font-weight: 500; }
.record-duration { color: var(--color-text-3); font-weight: 500; }
.record-status { color: var(--color-text-2); font-size: 0.85rem; margin-top: 0.3rem; }
.record-notes { color: var(--color-text-2); font-size: 0.9rem; margin-top: 0.3rem; }
.record-device { color: var(--color-text-4); font-size: 0.75rem; margin-top: 0.3rem; }

.delete-btn {
  background: var(--color-danger-soft); color: var(--color-danger-dark); border: 1px solid var(--color-danger-soft);
  padding: 0.35rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.8rem;
  font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
}
.delete-btn:focus-visible { outline: 2px solid var(--color-danger); outline-offset: 2px; }
.delete-btn:hover { background: #fecaca; }
.delete-btn:active { background: var(--color-danger-soft); transform: scale(0.97); }

@media (max-width: 600px) {
  .filter-grid { grid-template-columns: 1fr 1fr; }
  .stats-card { grid-template-columns: repeat(3, 1fr); padding: 0.85rem; }
  .stat-value { font-size: 1.2rem; }
}
@media (max-width: 420px) {
  .filter-grid { grid-template-columns: 1fr; }
}

@media (prefers-color-scheme: dark) {
  .filter-card, .records-section, .empty-state, .record-card, .loading {
    background: var(--color-surface);
  }
  .page-title, .stat-value, .section-title, .modal-title {
    color: var(--color-text);
  }
  .field, .record-status, .record-notes, .record-device {
    color: var(--color-text-2);
  }
  .record-category, .record-duration {
    color: var(--color-text-3);
  }
  .btn-outline {
    background: var(--color-surface-2);
    border-color: var(--color-border);
    color: var(--color-primary);
  }
  .input {
    background: var(--color-surface-2);
    border-color: var(--color-border);
    color: var(--color-text);
  }
  .error-message {
    background: var(--color-danger-soft);
    color: var(--color-danger-dark);
  }
  .delete-btn {
    background: var(--color-danger-soft);
    border-color: var(--color-danger-soft);
  }
  .spinner { border-color: var(--color-border); border-top-color: var(--color-primary); }
}
</style>
