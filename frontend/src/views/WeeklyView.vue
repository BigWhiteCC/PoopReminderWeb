<template>
  <div class="weekly-view">
    <h1 class="page-title">📊 周视图</h1>

    <!-- 周选择 -->
    <div class="week-nav">
      <button class="arrow-btn" @click="shiftWeek(-1)">
        <span class="arrow-icon">‹</span><span class="arrow-text">上一周</span>
      </button>
      <div class="week-label">
        <div class="week-title">{{ weekLabel }}</div>
        <div class="week-subtitle">{{ rangeSubtitle }}</div>
      </div>
      <button class="arrow-btn" @click="shiftWeek(1)">
        <span class="arrow-text">下一周</span><span class="arrow-icon">›</span>
      </button>
    </div>

    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>

    <!-- 数据概览 -->
    <div v-if="summary && summary.totalCount > 0" class="summary-grid">
      <div class="summary-card gradient-1">
        <div class="summary-label">本周次数</div>
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
    </div>

    <!-- 柱状图：每日次数（点击查看当日详情） -->
    <div class="chart-section" v-if="days.length">
      <div class="chart-title">💩 本周每日次数</div>
      <div class="bar-chart">
        <button
          v-for="day in days"
          :key="day.date"
          class="bar-column"
          :class="{ 'is-today': day.date === todayKey, 'has-record': day.count > 0 }"
          @click="openDayDetail(day)"
        >
          <div class="bar-count-top" v-if="day.count > 0">{{ day.count }}</div>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{ height: barHeight(day.count) + '%' }"
            ></div>
          </div>
          <div class="bar-labels">
            <div class="bar-weekday">{{ day.weekday }}</div>
            <div class="bar-date">{{ day.date.slice(5) }}</div>
            <div class="bar-avg" v-if="day.count > 0">{{ formatDurationShort(day.avgDuration) }}</div>
            <div class="bar-avg bar-avg-zero" v-else>-</div>
          </div>
        </button>
      </div>
    </div>

    <!-- 当日详情弹窗 -->
    <div v-if="activeDay" class="modal-overlay" @click.self="activeDay = null">
      <div class="modal-card">
        <div class="modal-header">
          <h3 class="modal-title">{{ activeDay.weekday }} · {{ activeDay.date }}</h3>
          <button class="modal-close" @click="activeDay = null" aria-label="关闭">✕</button>
        </div>

        <div class="modal-summary" v-if="activeDay.count > 0">
          <div class="modal-summary-item">
            <div class="ms-label">次数</div>
            <div class="ms-value">{{ activeDay.count }}</div>
          </div>
          <div class="modal-summary-item">
            <div class="ms-label">平均时长</div>
            <div class="ms-value">{{ formatDuration(activeDay.avgDuration) }}</div>
          </div>
        </div>

        <div v-if="activeDay.count === 0" class="modal-empty">
          <div class="modal-empty-icon">📭</div>
          <p>当日无记录</p>
        </div>

        <div v-else-if="Object.keys(activeDay.typeCounts || {}).length" class="type-block">
          <div class="type-title">类型分布</div>
          <div class="type-chip-row">
            <span
              v-for="(c, id) in activeDay.typeCounts"
              :key="id"
              class="type-chip"
              :title="getPoopTypeName(Number(id))"
            >
              {{ getPoopTypeEmoji(Number(id)) }} {{ getPoopTypeName(Number(id)) }} × {{ c }}
            </span>
          </div>
        </div>

        <div v-if="activeDayRecords.length > 0" class="day-record-list">
          <div class="type-title">当日明细</div>
          <div v-for="record in activeDayRecords" :key="record.id" class="day-record-item">
            <div class="day-record-main">
              <div class="day-record-time">{{ formatDateTime(record.date) }}</div>
              <div class="day-record-type">
                {{ getPoopTypeEmoji(record.poopType) }} {{ getPoopTypeName(record.poopType) }}
                <span v-if="getPoopTypeCategory(record.poopType)" class="day-record-category">（{{ getPoopTypeCategory(record.poopType) }}）</span>
                <span v-if="record.duration" class="day-record-duration"> · {{ formatDuration(record.duration) }}</span>
              </div>
            </div>
            <button class="delete-btn" @click="handleDelete(record.id)">删除</button>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-outline btn" @click="activeDay = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 详细记录 -->
    <div v-if="records.length > 0" class="records-section">
      <div class="records-header">
        <h2 class="section-title">{{ rangeSubtitle }}详细记录</h2>
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
              {{ getPoopTypeEmoji(record.poopType) }} {{ getPoopTypeName(record.poopType) }}
              <span v-if="getPoopTypeCategory(record.poopType)" class="record-category">（{{ getPoopTypeCategory(record.poopType) }}）</span>
              <span v-if="record.duration" class="record-duration"> · {{ formatDuration(record.duration) }}</span>
            </div>
          </div>
          <button class="delete-btn" @click="handleDelete(record.id)">删除</button>
        </div>
      </div>
    </div>

    <div v-else-if="!loading && summary.totalCount === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p>本周暂无记录</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, ApiError, formatDuration, formatDurationShort } from '../services/api'

const poopTypes = ref([])
const weekStart = ref(getMonday(new Date()))
const days = ref([])
const summary = ref({ totalCount: 0, avgDuration: 0, avgPerDay: 0 })
const records = ref([])
const loading = ref(false)
const errorMessage = ref('')
// 服务端返回的真实周范围，用于确保标题与下方"详细记录"的日期一致
const serverRange = ref({ start: '', end: '' })
const activeDay = ref(null)

const todayKey = computed(() => {
  const t = new Date()
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
})

const maxDayCount = computed(() => {
  let m = 0
  for (const d of days.value) if (d.count > m) m = d.count
  return m
})

function barHeight(count) {
  const m = maxDayCount.value
  if (!m) return 0
  // 最小高度 3%，避免 1 次时几乎看不见
  const pct = (count / m) * 100
  return Math.max(3, pct)
}

// 当日记录明细（按时间倒序）
const activeDayRecords = computed(() => {
  if (!activeDay.value) return []
  const key = activeDay.value.date
  return records.value
    .filter(r => toDateKeyLocal(r.date) === key)
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
})

function toDateKeyLocal(dateStr) {
  if (!dateStr) return ''
  const prefixMatch = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (prefixMatch) return `${prefixMatch[1]}-${prefixMatch[2]}-${prefixMatch[3]}`
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function openDayDetail(day) {
  activeDay.value = day
}

function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function pad(n) { return String(n).padStart(2, '0') }

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 标题周范围基于服务端返回的 range（与"详细记录"同一周）
const weekLabel = computed(() => {
  if (!serverRange.value.start) {
    const s = weekStart.value
    return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日起的一周`
  }
  const s = new Date(serverRange.value.start)
  const end = new Date(serverRange.value.end)
  end.setDate(end.getDate() - 1) // end 是下周一（不含），显示时 -1
  if (isNaN(s.getTime()) || isNaN(end.getTime())) return ''
  if (s.getFullYear() === end.getFullYear()) {
    return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`
  }
  return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 - ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`
})
const rangeSubtitle = computed(() => {
  if (!serverRange.value.start) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const s = new Date(serverRange.value.start)
  const nextMon = new Date(serverRange.value.end)
  if (isNaN(s.getTime()) || isNaN(nextMon.getTime())) return ''
  if (today >= s && today < nextMon) return '本周'
  if (today < s) return '未来'
  const diff = Math.round((today - s) / (7 * 86400000))
  return diff > 0 ? `${diff} 周前` : '过去'
})

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

function shiftWeek(n) {
  const nxt = new Date(weekStart.value)
  nxt.setDate(weekStart.value.getDate() + n * 7)
  weekStart.value = nxt
  loadData()
}

function showError(msg) {
  errorMessage.value = msg
  setTimeout(() => { errorMessage.value = '' }, 3500)
}

async function loadData() {
  loading.value = true
  try {
    const startISO = dateKey(weekStart.value) // 用本地 YYYY-MM-DD，避免 toISOString 的 UTC 偏移
    const data = await api.getWeekly({ date: startISO })

    // 保存服务端返回的周范围，让标题与下方详细记录一致
    if (data.range && data.range.start) {
      serverRange.value = { start: data.range.start, end: data.range.end }
    } else {
      const s = new Date(weekStart.value)
      const e = new Date(weekStart.value)
      e.setDate(e.getDate() + 7)
      serverRange.value = { start: s.toISOString(), end: e.toISOString() }
    }

    // 按顺序填充周一到周日（以服务端 range.start 为基准，而非本地 weekStart，
    // 避免两端时区差异导致日期与柱状图错位）
    const baseStart = data.range && data.range.start
      ? new Date(data.range.start)
      : new Date(weekStart.value)
    baseStart.setHours(0, 0, 0, 0)

    const byDay = {}
    ;(data.days || []).forEach(d => { byDay[d.date] = d })
    const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    days.value = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(baseStart)
      d.setDate(baseStart.getDate() + i)
      const key = dateKey(d)
      // 同时兼容服务端可能返回的 UTC key（如 "2026-06-14" 与本地 06/14 一致）
      const info = byDay[key] || { count: 0, avgDuration: 0, typeCounts: {} }
      days.value.push({
        date: key,
        weekday: weekdayNames[i],
        count: info.count || 0,
        avgDuration: info.avgDuration || 0,
        typeCounts: info.typeCounts || {}
      })
    }
    summary.value = data.summary || { totalCount: 0, avgDuration: 0, avgPerDay: 0 }
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

async function handleExportTxt() {
  try {
    const text = api.buildTextFromRecords(records.value, {
      title: weekLabel.value ? `周记录（${weekLabel.value}）` : '周记录',
      poopTypes: poopTypes.value
    })
    const today = new Date()
    const pad = n => String(n).padStart(2, '0')
    const name = `weekly_${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`
    api.downloadAsTxt(text, name)
  } catch (err) { showError('导出失败') }
}

async function handleCopy() {
  try {
    const text = api.buildTextFromRecords(records.value, {
      title: weekLabel.value ? `周记录（${weekLabel.value}）` : '周记录',
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
.weekly-view { animation: fadeIn 0.4s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.page-title { font-size: 1.5rem; color: #1f2937; margin-bottom: 1rem; text-align: center; font-weight: 700; }

.week-nav {
  display: flex; flex-wrap: nowrap; align-items: center;
  background: white; padding: 0.75rem 1rem; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 1rem; gap: 0.5rem;
}
.arrow-btn {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; min-width: 44px;
  padding: 0.55rem 0.75rem; border: 1px solid #e5e7eb; background: white;
  border-radius: 10px; font-size: 0.9rem; color: #374151; cursor: pointer;
  font-weight: 500; white-space: nowrap;
}
.arrow-btn .arrow-icon { font-size: 1.2rem; line-height: 1; font-weight: 700; }
.arrow-btn .arrow-text { margin: 0 0.25rem; }
.arrow-btn:active { background: #f3f4f6; transform: scale(0.97); }
.week-label { flex: 1 1 auto; text-align: center; min-width: 0; }
.week-title { font-weight: 700; color: #111827; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.week-subtitle { font-size: 0.75rem; color: #6b7280; margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.error-message {
  background: #fef2f2; color: #dc2626; padding: 0.85rem 1rem;
  border-radius: 12px; margin-bottom: 0.75rem; text-align: center; font-size: 0.95rem;
}

.summary-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem; margin-bottom: 1rem;
}
.summary-card {
  border-radius: 14px; padding: 1rem 0.75rem; color: white; text-align: center;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}
.gradient-1 { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.gradient-2 { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.gradient-3 { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.summary-label { font-size: 0.8rem; opacity: 0.95; }
.summary-value { font-size: 1.6rem; font-weight: 800; margin-top: 0.1rem; }

/* 柱状图 */
.chart-section {
  background: white; border-radius: 16px; padding: 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 1rem;
  overflow: hidden;
}
.chart-title { font-size: 1rem; font-weight: 700; color: #1f2937; margin-bottom: 0.75rem; }
.bar-chart {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 0.4rem; align-items: stretch;
  min-height: 200px;
}
.bar-column {
  display: flex; flex-direction: column; align-items: center;
  background: transparent; border: none; padding: 0.25rem 0.15rem; border-radius: 12px;
  cursor: pointer; transition: background 0.15s ease, transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  min-width: 0;
}
.bar-column:hover { background: #eef2ff; }
.bar-column:active { transform: scale(0.97); }
.bar-column.has-record { cursor: pointer; }
.bar-count-top {
  font-size: 0.85rem; font-weight: 700; color: #4338ca;
  min-height: 1rem;
}
.bar-track {
  position: relative;
  width: 100%; max-width: 44px;
  flex: 1 1 auto; min-height: 60px;
  background: #f1f5f9;
  border-radius: 10px 10px 6px 6px;
  overflow: hidden;
  display: flex; align-items: flex-end;
  margin: 0.15rem 0;
}
.bar-fill {
  width: 100%;
  background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
  border-radius: 10px 10px 6px 6px;
  transition: height 0.4s ease;
  box-shadow: inset 0 -2px 0 rgba(0,0,0,0.08);
}
.bar-column.is-today .bar-fill {
  background: linear-gradient(180deg, #f5576c 0%, #f093fb 100%);
}
.bar-labels {
  display: flex; flex-direction: column; align-items: center;
  gap: 0.05rem; text-align: center; flex-shrink: 0;
  padding-top: 0.25rem;
}
.bar-weekday { font-size: 0.78rem; font-weight: 700; color: #111827; white-space: nowrap; }
.bar-date { font-size: 0.7rem; color: #6b7280; white-space: nowrap; }
.bar-avg { font-size: 0.68rem; color: #4b5563; font-weight: 600; white-space: nowrap; }
.bar-avg-zero { color: #9ca3af; }

/* 当日详情弹窗 */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: flex-end; justify-content: center;
  z-index: 1000; animation: fadeIn 0.2s ease;
}
.modal-card {
  width: 100%; max-width: 480px; background: #fff;
  border-radius: 20px 20px 0 0; padding: 1.25rem;
  max-height: 85vh; overflow-y: auto;
  animation: slideUp 0.25s ease;
  box-shadow: 0 -10px 40px rgba(0,0,0,0.15);
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.75rem;
}
.modal-title { margin: 0; font-size: 1.1rem; color: #1f2937; font-weight: 700; }
.modal-close {
  background: #f3f4f6; border: none; border-radius: 999px;
  width: 32px; height: 32px; cursor: pointer; font-size: 0.9rem; color: #4b5563;
}
.modal-summary {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.75rem;
}
.modal-summary-item {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white; border-radius: 12px; padding: 0.75rem; text-align: center;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
}
.ms-label { font-size: 0.75rem; opacity: 0.9; }
.ms-value { font-size: 1.5rem; font-weight: 800; margin-top: 0.1rem; }

.modal-empty { text-align: center; padding: 1.5rem 0.5rem; color: #6b7280; }
.modal-empty-icon { font-size: 2.5rem; margin-bottom: 0.25rem; }

.type-block { margin-bottom: 0.75rem; }
.type-title { font-size: 0.8rem; color: #6b7280; margin-bottom: 0.35rem; font-weight: 600; }
.type-chip-row { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.type-chip {
  background: #e0e7ff; color: #4338ca;
  padding: 0.25rem 0.6rem; border-radius: 999px;
  font-size: 0.8rem; font-weight: 600;
}

.day-record-list { margin-top: 0.25rem; }
.day-record-item {
  display: flex; gap: 0.6rem; align-items: flex-start;
  padding: 0.65rem 0.75rem; border-radius: 10px; background: #f8fafc;
  margin-bottom: 0.4rem;
}
.day-record-main { flex: 1; min-width: 0; }
.day-record-time { color: #667eea; font-weight: 600; font-size: 0.85rem; }
.day-record-type { color: #4c1d95; font-size: 0.85rem; font-weight: 600; margin-top: 0.1rem; }
.day-record-category { color: #6b7280; font-weight: 500; }
.day-record-duration { color: #6b7280; font-weight: 500; }
.day-record-status { font-size: 0.8rem; color: #374151; margin-top: 0.15rem; }
.day-record-notes { font-size: 0.85rem; color: #374151; margin-top: 0.15rem; }

.modal-actions { display: flex; justify-content: flex-end; margin-top: 1rem; }
.modal-actions .btn { min-height: 38px; padding: 0.5rem 1rem; background: #667eea; color: white; border-color: #667eea; border-radius: 10px; font-size: 0.9rem; font-weight: 600; cursor: pointer; }

.records-section {
  background: white; border-radius: 16px; padding: 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}
.records-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.section-title { font-size: 1.05rem; color: #1f2937; font-weight: 700; margin: 0; }

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
.record-main { flex: 1; min-width: 0; }
.record-time { color: #667eea; font-weight: 600; font-size: 0.85rem; }
.record-type { color: #4c1d95; font-size: 0.85rem; font-weight: 600; margin-top: 0.1rem; }
.record-category { color: #6b7280; font-weight: 500; }
.record-duration { color: #6b7280; font-weight: 500; }
.record-status { font-size: 0.8rem; color: #374151; margin-top: 0.15rem; }
.record-notes { font-size: 0.85rem; color: #374151; margin-top: 0.15rem; }

.delete-btn {
  background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;
  padding: 0.3rem 0.5rem; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
  cursor: pointer; flex-shrink: 0;
}

.empty-state {
  background: white; border-radius: 16px; padding: 3rem 1rem; text-align: center;
  color: #6b7280; box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
.empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }

@media (max-width: 720px) {
  .bar-track { max-width: 36px; }
  .bar-count-top { font-size: 0.75rem; }
  .bar-weekday { font-size: 0.72rem; }
}
@media (max-width: 520px) {
  .arrow-btn .arrow-text { display: none; }
  .arrow-btn { padding: 0.55rem 0.5rem; min-width: 40px; }
}
@media (max-width: 420px) {
  .week-nav { padding: 0.6rem 0.5rem; gap: 0.35rem; }
  .week-title { font-size: 0.9rem; }
  .week-subtitle { font-size: 0.7rem; }
  .summary-grid { grid-template-columns: 1fr; }
  .summary-value { font-size: 1.4rem; }
  .bar-chart { gap: 0.2rem; }
  .bar-track { max-width: 28px; }
  .bar-weekday { font-size: 0.7rem; }
  .bar-date { font-size: 0.62rem; }
  .bar-avg { font-size: 0.6rem; }
}
</style>
