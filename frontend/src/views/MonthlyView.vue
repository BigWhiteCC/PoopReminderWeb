<template>
  <div class="monthly-view">
    <h1 class="page-title">🗓️ 月视图</h1>

    <!-- 月份切换 -->
    <div class="month-nav">
      <button class="arrow-btn" @click="shiftMonth(-1)">
        <span class="arrow-icon">‹</span><span class="arrow-text">上个月</span>
      </button>
      <div class="month-label">
        <div class="month-title">{{ monthTitle }}</div>
        <div class="month-subtitle">共 {{ summary.totalCount }} 次记录</div>
      </div>
      <button class="arrow-btn" @click="shiftMonth(1)">
        <span class="arrow-text">下个月</span><span class="arrow-icon">›</span>
      </button>
    </div>

    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>

    <!-- 概览 -->
    <div v-if="summary.totalCount > 0" class="summary-grid">
      <div class="summary-card gradient-1">
        <div class="summary-label">本月次数</div>
        <div class="summary-value">{{ summary.totalCount }}</div>
      </div>
      <div class="summary-card gradient-2">
        <div class="summary-label">平均时长</div>
        <div class="summary-value">{{ formatDuration(summary.avgDuration) }}</div>
      </div>
      <div class="summary-card gradient-3">
        <div class="summary-label">日均次数</div>
        <div class="summary-value">{{ summary.avgPerDay }}</div>
      </div>
      <div class="summary-card gradient-4" v-if="compareWithLastMonth.count !== undefined">
        <div class="summary-label">环比上月</div>
        <div class="summary-value" :class="compareWithLastMonth.diff >= 0 ? 'positive' : 'negative'">
          {{ compareWithLastMonth.diff }}%
        </div>
      </div>
    </div>

    <!-- 日历 -->
    <div class="calendar">
      <div class="calendar-weekdays">
        <div v-for="wd in weekdayNames" :key="wd" class="weekday">{{ wd }}</div>
      </div>
      <div class="calendar-grid">
        <div
          v-for="(day, idx) in calendarDays" :key="idx"
          class="calendar-cell"
          :class="{ 'is-empty': !day, 'has-record': day && day.count > 0, 'is-selected': day && day.count > 0 && day.date === selectedDay }"
          @click="openDay(day)"
          :title="day && day.count > 0 ? `${day.date} · ${day.count} 次记录` : (day ? `${day.date} · 无记录` : '')"
        >
          <template v-if="day">
            <div class="cell-date">{{ day.dayNum }}</div>
            <div v-if="day.count > 0" class="cell-count">{{ day.count }}</div>
          </template>
        </div>
      </div>
    </div>

    <!-- 单日详情弹窗 -->
    <div v-if="selectedDay" class="modal-overlay" @click.self="closeDayModal">
      <div class="modal-card day-modal">
        <div class="modal-head">
          <h3 class="modal-title">{{ selectedDay }} · 当日记录</h3>
          <button class="modal-close" @click="closeDayModal" aria-label="关闭">✕</button>
        </div>

        <div v-if="selectedDayRecords.length === 0" class="day-empty">该日无记录</div>

        <div v-else class="day-list">
          <div v-for="r in selectedDayRecords" :key="r.id" class="day-item">
            <div class="day-item-main">
              <div class="day-item-time">🕒 {{ formatDateTimeShort(r.date) }}</div>
              <div class="day-item-type">
                {{ getPoopTypeEmoji(r.poopType) }}
                <span v-if="r.duration" class="day-item-duration"> · {{ formatDuration(r.duration) }}</span>
              </div>
            </div>
            <button class="btn-danger" @click="handleDeleteDay(r.id)">删除</button>
          </div>
        </div>

        <div class="day-summary" v-if="selectedDayRecords.length > 0">
          <div class="summary-row">
            <span>当日次数</span><strong>{{ selectedDayRecords.length }}</strong>
          </div>
          <div class="summary-row">
            <span>平均时长</span>
            <strong>
              {{ formatDuration(Math.round(selectedDayRecords.reduce((s, r) => s + (Number(r.duration) || 0), 0) / selectedDayRecords.length)) }}
            </strong>
          </div>
        </div>
      </div>
    </div>

    <!-- 每周对比 -->
    <div v-if="weeks.length > 0" class="weeks-section">
      <h2 class="section-title">📊 每周对比</h2>
      <div class="weeks-grid">
        <div v-for="(w, idx) in weeks" :key="idx" class="week-card">
          <div class="week-header">第 {{ idx + 1 }} 周 · {{ w.label }}</div>
          <div class="week-body">
            <div class="week-meta">
              <div class="week-count">{{ w.count }} 次</div>
              <div class="week-avg" v-if="w.avgDuration">平均 {{ formatDuration(w.avgDuration) }}</div>
            </div>
            <div v-if="Object.keys(w.typeStats || {}).length" class="week-types">
              <span v-for="(c, id) in w.typeStats" :key="id" class="type-chip">
                {{ getPoopTypeEmoji(Number(id)) }} {{ c }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 类型分布 -->
    <div v-if="summary.typeStats && Object.keys(summary.typeStats).length > 0" class="type-dist">
      <h2 class="section-title">🧬 类型分布</h2>
      <div class="type-bars">
        <div v-for="pt in poopTypes" :key="pt.id" class="type-bar-row">
          <span class="type-bar-label">{{ pt.emoji }} {{ pt.name }}</span>
          <div class="type-bar-track">
            <div class="type-bar-fill"
              :style="{ width: getTypePercent(pt.id) + '%' }"></div>
          </div>
          <span class="type-bar-value">{{ summary.typeStats[pt.id] || 0 }}</span>
        </div>
      </div>
    </div>

    <!-- 本月记录 -->
    <div v-if="records.length > 0" class="records-section">
      <div class="records-header">
        <h2 class="section-title">本月记录明细</h2>
        <div class="export-buttons">
          <button class="btn btn-outline" @click="handleExportTxt">导出文本</button>
          <button class="btn btn-outline" @click="handleCopy">复制到剪贴板</button>
        </div>
      </div>
      <div class="records-list">
        <div v-for="record in records" :key="record.id" class="record-item">
          <div class="record-main">
            <div class="record-time">{{ formatDateTime(record.date) }}</div>
            <div class="record-type">
              {{ getPoopTypeEmoji(record.poopType) }}
              <span v-if="record.duration" class="record-duration"> · {{ formatDuration(record.duration) }}</span>
            </div>
          </div>
          <button class="delete-btn" @click="handleDelete(record.id)">删除</button>
        </div>
      </div>
    </div>

    <div v-else-if="!loading && summary.totalCount === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p>本月暂无记录</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { api, ApiError, formatDuration, formatDurationShort } from '../services/api'

const weekdayNames = ['一', '二', '三', '四', '五', '六', '日']
const poopTypes = ref([])
const monthStart = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const days = ref([])
const weeks = ref([])
const summary = ref({ totalCount: 0, avgDuration: 0, avgPerDay: 0, typeStats: {} })
const compareWithLastMonth = ref({})
const records = ref([])
const loading = ref(false)
const errorMessage = ref('')
const selectedDay = ref(null) // 'YYYY-MM-DD'

function pad(n) { return String(n).padStart(2, '0') }

const monthTitle = computed(() => {
  return `${monthStart.value.getFullYear()} 年 ${monthStart.value.getMonth() + 1} 月`
})

// 选中那一天的记录（从 records 里按日期前缀过滤，并且按时间升序显示）
const selectedDayRecords = computed(() => {
  if (!selectedDay.value) return []
  const key = String(selectedDay.value)
  return (records.value || [])
    .filter(r => {
      if (!r || !r.date) return false
      const d = String(r.date).slice(0, 10)
      return d === key
    })
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
})

function formatDateTimeShort(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return String(dateStr).slice(0, 16).replace('T', ' ')
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function openDay(dayCell) {
  if (!dayCell || !dayCell.count) return
  selectedDay.value = dayCell.date
}
function closeDayModal() { selectedDay.value = null }

function getPoopTypeEmoji(id) {
  const pt = poopTypes.value.find(t => t.id === id)
  return pt ? pt.emoji : '💩'
}
function getPoopTypeName(id) {
  const pt = poopTypes.value.find(t => t.id === id)
  return pt ? pt.name : '未知类型'
}
function getTypePercent(id) {
  const total = summary.value.totalCount || 0
  if (total === 0) return 0
  return Math.round(((summary.value.typeStats[id] || 0) / total) * 1000) / 10
}

function shiftMonth(n) {
  const cur = monthStart.value
  const nxt = new Date(cur.getFullYear(), cur.getMonth() + n, 1)
  monthStart.value = nxt
  selectedDay.value = null
  loadData()
}

function showError(msg) {
  errorMessage.value = msg
  setTimeout(() => { errorMessage.value = '' }, 3500)
}

const calendarDays = computed(() => {
  // 生成日历格子
  const year = monthStart.value.getFullYear()
  const month = monthStart.value.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // 本月第一天是周几（周一为1，周日为7）
  let firstWeekday = new Date(year, month, 1).getDay()
  const offset = firstWeekday === 0 ? 6 : firstWeekday - 1
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  // 把每一天的信息填入
  const byDay = {}
  days.value.forEach(d => { byDay[d.date] = d })
  for (let i = 1; i <= daysInMonth; i++) {
    const key = `${year}-${pad(month + 1)}-${pad(i)}`
    const info = byDay[key] || { count: 0, avgDuration: 0 }
    cells.push({ date: key, dayNum: i, count: info.count || 0 })
  }
  // 补齐到7的倍数
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
})

async function loadData() {
  loading.value = true
  try {
    const dateParam = `${monthStart.value.getFullYear()}-${pad(monthStart.value.getMonth() + 1)}`
    const data = await api.getMonthly({ date: dateParam })
    days.value = data.days || []
    weeks.value = data.weeks || []
    summary.value = data.summary || { totalCount: 0, avgDuration: 0, avgPerDay: 0, typeStats: {} }
    summary.value.typeStats = summary.value.typeStats || {}
    compareWithLastMonth.value = data.compareWithLastMonth || { count: 0, diff: 0 }
    records.value = data.records || []
  } catch (err) {
    if (err instanceof ApiError) showError(`加载失败: ${err.message}`)
    else showError('加载失败')
  } finally {
    loading.value = false
  }
}

async function handleDelete(id) {
  if (!confirm('确定要删除这条记录吗？')) return
  try {
    await api.deleteRecord(id)
    loadData()
  } catch (err) { showError('删除失败') }
}

async function handleDeleteDay(id) {
  if (!confirm('确定要删除这条记录吗？')) return
  try {
    await api.deleteRecord(id)
    // 若删除后当天空了，自动关闭弹窗
    const remain = (records.value || []).filter(r => {
      if (!r || r.id === id) return false
      const d = String(r.date).slice(0, 10)
      return d === selectedDay.value
    })
    loadData()
    if (remain.length === 0) closeDayModal()
  } catch (err) { showError('删除失败') }
}

async function handleExportTxt() {
  try {
    const text = api.buildTextFromRecords(records.value, {
      title: `月记录（${monthTitle.value}）`,
      poopTypes: poopTypes.value
    })
    const name = `monthly_${monthStart.value.getFullYear()}${pad(monthStart.value.getMonth() + 1)}`
    api.downloadAsTxt(text, name)
  } catch (err) { showError('导出失败') }
}

async function handleCopy() {
  try {
    const text = api.buildTextFromRecords(records.value, {
      title: `月记录（${monthTitle.value}）`,
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

function formatDateTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

onMounted(async () => {
  try {
    const t = await api.getPoopTypes()
    poopTypes.value = t.types
  } catch (_) {}
  loadData()
})
</script>

<style scoped>
.monthly-view { animation: fadeIn 0.4s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.page-title { font-size: 1.5rem; color: #1f2937; margin-bottom: 1rem; text-align: center; font-weight: 700; }

.month-nav {
  display: flex; flex-wrap: nowrap; align-items: center;
  gap: 0.5rem;
  background: white; padding: 0.75rem 1rem; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 1rem;
}
.arrow-btn {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; min-width: 44px;
  padding: 0.55rem 0.75rem; border: 1px solid #e5e7eb;
  background: white; border-radius: 10px; font-size: 0.9rem; color: #374151;
  cursor: pointer; font-weight: 500; white-space: nowrap;
}
.arrow-btn .arrow-icon { font-size: 1.2rem; line-height: 1; font-weight: 700; }
.arrow-btn .arrow-text { margin: 0 0.25rem; }
.arrow-btn:active { background: #f3f4f6; transform: scale(0.97); }
.month-label { flex: 1 1 auto; text-align: center; min-width: 0; }
.month-title { font-weight: 700; color: #111827; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.month-subtitle { font-size: 0.75rem; color: #6b7280; margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.error-message {
  background: #fef2f2; color: #dc2626; padding: 0.85rem 1rem;
  border-radius: 12px; margin-bottom: 0.75rem; text-align: center;
  font-size: 0.95rem;
}

.summary-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 1rem;
}
.summary-card {
  border-radius: 14px; padding: 0.85rem 0.5rem; color: white; text-align: center;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}
.gradient-1 { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.gradient-2 { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.gradient-3 { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.gradient-4 { background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); }

.summary-label { font-size: 0.75rem; opacity: 0.95; }
.summary-value { font-size: 1.4rem; font-weight: 800; margin-top: 0.15rem; }
.summary-value.positive { color: #bbf7d0; }
.summary-value.negative { color: #fecaca; }

.calendar {
  background: white; border-radius: 16px; padding: 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 1rem;
}

.calendar-weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 0.25rem; margin-bottom: 0.4rem;
}
.weekday {
  text-align: center; font-size: 0.8rem; color: #6b7280; font-weight: 600;
}

.calendar-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.3rem;
}
.calendar-cell {
  aspect-ratio: 1 / 1; background: #f8fafc; border-radius: 10px;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.15rem;
  font-size: 0.9rem; color: #374151; font-weight: 600;
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s;
}
.calendar-cell.is-empty { background: transparent; pointer-events: none; }
.calendar-cell.has-record {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  color: #3730a3; font-weight: 700;
  cursor: pointer;
}
.calendar-cell.has-record:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(99,102,241,0.22); }
.calendar-cell.is-selected {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}
.cell-date { font-size: 0.85rem; }
.cell-count {
  font-size: 0.65rem; background: #6366f1; color: white;
  border-radius: 999px; padding: 0.05rem 0.35rem; line-height: 1.4;
}

/* 单日详情弹窗 */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(17, 24, 39, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem; z-index: 50;
}
.modal-card {
  background: white; border-radius: 18px; padding: 1.25rem 1.25rem 1.5rem;
  width: 100%; max-width: 520px; max-height: 82vh; overflow: hidden;
  display: flex; flex-direction: column; box-shadow: 0 14px 40px rgba(15,23,42,0.25);
  animation: pop-in 0.18s ease-out;
}
@keyframes pop-in {
  from { transform: translateY(8px) scale(0.97); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
.modal-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 0.75rem; border-bottom: 1px solid #f1f5f9; margin-bottom: 0.75rem;
}
.modal-title { margin: 0; font-size: 1rem; color: #111827; font-weight: 700; }
.modal-close {
  background: #f3f4f6; border: 0; border-radius: 10px;
  width: 32px; height: 32px; color: #6b7280; font-size: 1rem; cursor: pointer;
}
.modal-close:hover { background: #e5e7eb; color: #111827; }
.day-empty { color: #6b7280; text-align: center; padding: 1.5rem 0; }

.day-list { overflow-y: auto; padding-right: 0.25rem; margin-bottom: 0.5rem; }
.day-item {
  background: #f9fafb; border-radius: 12px; padding: 0.75rem 0.85rem;
  margin-bottom: 0.55rem; display: flex; gap: 0.75rem; align-items: flex-start;
  border: 1px solid #f1f5f9;
}
.day-item-main { flex: 1; min-width: 0; }
.day-item-time { font-size: 0.85rem; color: #475569; font-weight: 600; }
.day-item-type { font-size: 0.92rem; color: #111827; margin-top: 0.15rem; font-weight: 600; }
.day-item-duration { color: #6366f1; font-weight: 600; }
.day-item-status, .day-item-notes {
  margin-top: 0.25rem; font-size: 0.82rem; color: #4b5563;
  word-break: break-word;
}
.btn-danger {
  background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;
  padding: 0.3rem 0.65rem; border-radius: 8px; font-size: 0.8rem;
  cursor: pointer; font-weight: 600; flex-shrink: 0;
}
.btn-danger:hover { background: #fecaca; }

.day-summary {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem;
  padding-top: 0.75rem; border-top: 1px dashed #e5e7eb; margin-top: 0.5rem;
}
.summary-row {
  display: flex; justify-content: space-between; align-items: baseline;
  background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 10px;
  font-size: 0.85rem; color: #475569;
}
.summary-row strong { color: #111827; font-size: 1rem; }

.weeks-section, .type-dist, .records-section {
  background: white; border-radius: 16px; padding: 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 1rem;
}

.section-title {
  font-size: 1.05rem; color: #1f2937; margin: 0 0 0.75rem 0; font-weight: 700;
}

.weeks-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
.week-card {
  background: #f8fafc; border-radius: 12px; padding: 0.75rem;
}
.week-header { font-size: 0.8rem; color: #667eea; font-weight: 600; margin-bottom: 0.35rem; }
.week-body { display: flex; flex-direction: column; gap: 0.35rem; }
.week-meta { display: flex; align-items: baseline; gap: 0.5rem; }
.week-count { font-size: 1.4rem; font-weight: 800; color: #111827; }
.week-avg { font-size: 0.8rem; color: #6b7280; }
.week-types { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.type-chip { background: #e0e7ff; color: #4338ca; padding: 0.15rem 0.4rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }

.type-bars { display: flex; flex-direction: column; gap: 0.5rem; }
.type-bar-row { display: grid; grid-template-columns: 110px 1fr 40px; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.type-bar-label { color: #374151; font-weight: 500; }
.type-bar-track { background: #e5e7eb; height: 12px; border-radius: 999px; overflow: hidden; }
.type-bar-fill {
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  height: 100%; border-radius: 999px; transition: width 0.4s ease;
}
.type-bar-value { text-align: right; color: #374151; font-weight: 600; }

.records-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.75rem;
}

.btn { padding: 0.5rem 0.85rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: 2px solid transparent; min-height: 38px; }
.btn-outline { background: white; color: #667eea; border-color: #cbd5e1; }
.btn:active { transform: scale(0.97); }

.export-buttons { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.export-buttons .btn { min-height: 34px; padding: 0.4rem 0.75rem; }

.records-list { display: flex; flex-direction: column; gap: 0.5rem; }
.record-item {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 0.65rem 0.75rem; border-radius: 10px; background: #f8fafc;
}
.record-main { flex: 1; }
.record-time { color: #667eea; font-weight: 600; font-size: 0.85rem; }
.record-type { color: #4c1d95; font-size: 0.85rem; font-weight: 600; margin-top: 0.1rem; }
.record-duration { color: #6b7280; font-weight: 500; }
.record-status { font-size: 0.8rem; color: #374151; margin-top: 0.15rem; }
.record-notes { font-size: 0.85rem; color: #374151; margin-top: 0.15rem; }

.delete-btn {
  background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;
  padding: 0.3rem 0.5rem; border-radius: 8px; font-size: 0.75rem;
  font-weight: 600; cursor: pointer; flex-shrink: 0;
}

.empty-state {
  background: white; border-radius: 16px; padding: 3rem 1rem; text-align: center;
  color: #6b7280; box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
.empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }

@media (max-width: 720px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .weeks-grid { grid-template-columns: 1fr; }
  .type-bar-row { grid-template-columns: 90px 1fr 40px; font-size: 0.8rem; }
  .summary-value { font-size: 1.25rem; }
}
@media (max-width: 520px) {
  .arrow-btn .arrow-text { display: none; }
  .arrow-btn { padding: 0.55rem 0.5rem; min-width: 40px; }
}
@media (max-width: 420px) {
  .month-nav { padding: 0.6rem 0.5rem; gap: 0.35rem; }
  .month-title { font-size: 0.9rem; }
  .month-subtitle { font-size: 0.7rem; }
  .calendar { padding: 0.75rem; }
  .calendar-cell { aspect-ratio: auto; height: 44px; font-size: 0.85rem; }
  .cell-count { font-size: 0.6rem; }
}
</style>
