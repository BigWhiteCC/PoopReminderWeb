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
        <button
          v-for="(day, idx) in calendarDays" :key="idx"
          type="button"
          class="calendar-cell"
          :class="{ 'is-empty': !day, 'has-record': day && day.count > 0, 'is-selected': day && day.count > 0 && day.date === selectedDay }"
          :disabled="!day || day.count === 0"
          :aria-label="day ? (day.date + '，' + day.count + ' 次记录') : ''"
          @click="openDay(day)"
        >
          <template v-if="day">
            <span class="cell-date">{{ day.dayNum }}</span>
            <span v-if="day.count > 0" class="cell-count">{{ day.count }}</span>
          </template>
        </button>
      </div>
    </div>

    <!-- 单日详情弹窗 -->
    <div v-if="selectedDay" class="modal-overlay" @click.self="closeDayModal" @keydown.esc="closeDayModal">
      <div class="modal-card day-modal" role="dialog" aria-modal="true" aria-labelledby="day-modal-title" tabindex="-1">
        <div class="modal-head">
          <h3 id="day-modal-title" class="modal-title">{{ selectedDay }} · 当日记录</h3>
          <button type="button" class="modal-close" @click="closeDayModal" aria-label="关闭">✕</button>
        </div>

        <div v-if="selectedDayRecords.length === 0" class="day-empty">该日无记录</div>

        <div v-else class="day-list">
          <div v-for="r in selectedDayRecords" :key="r.id" class="day-item">
            <div class="day-item-main">
              <div class="day-item-time">🕒 {{ formatDateTimeShort(r.date) }}</div>
              <div class="day-item-type">
                {{ getPoopTypeEmoji(r.poopType) }} {{ getPoopTypeName(r.poopType) }}
                <span v-if="getPoopTypeCategory(r.poopType)" class="day-item-category">（{{ getPoopTypeCategory(r.poopType) }}）</span>
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
      <div class="chart-container">
        <canvas ref="typeChartCanvas"></canvas>
      </div>
    </div>

    <!-- 健康趋势分析 -->
    <div v-if="records.length > 0" class="health-trend-section">
      <h2 class="section-title">📈 健康趋势</h2>
      <div class="trend-cards">
        <div class="trend-card constipation">
          <div class="trend-icon">🚽</div>
          <div class="trend-info">
            <div class="trend-label">便秘天数</div>
            <div class="trend-value">{{ healthTrend.constipationDays }} 天</div>
          </div>
        </div>
        <div class="trend-card diarrhea">
          <div class="trend-icon">💨</div>
          <div class="trend-info">
            <div class="trend-label">腹泻天数</div>
            <div class="trend-value">{{ healthTrend.diarrheaDays }} 天</div>
          </div>
        </div>
        <div class="trend-card constipation-streak">
          <div class="trend-icon">📉</div>
          <div class="trend-info">
            <div class="trend-label">最长便秘连续</div>
            <div class="trend-value">{{ healthTrend.constipationStreak }} 天</div>
          </div>
        </div>
        <div class="trend-card diarrhea-streak">
          <div class="trend-icon">📈</div>
          <div class="trend-info">
            <div class="trend-label">最长腹泻连续</div>
            <div class="trend-value">{{ healthTrend.diarrheaStreak }} 天</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 季节性统计 -->
    <div v-if="seasonalStats.labels && seasonalStats.labels.length > 0" class="seasonal-section">
      <h2 class="section-title">🌿 月度趋势（近12个月日均次数）</h2>
      <div class="seasonal-grid">
        <div v-for="(label, idx) in seasonalStats.labels" :key="label" class="seasonal-item">
          <div class="seasonal-bar-container">
            <div class="seasonal-bar" :style="{ height: Math.min(seasonalStats.avgs[idx] * 20, 60) + 'px' }"></div>
          </div>
          <div class="seasonal-label">{{ label }}</div>
          <div class="seasonal-value">{{ seasonalStats.avgs[idx] }}</div>
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
      <p>本月暂无记录</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Chart, ArcElement, Tooltip, Legend, DoughnutController } from 'chart.js'
import { api, ApiError, formatDuration, formatDurationShort } from '../services/api'

Chart.register(ArcElement, Tooltip, Legend, DoughnutController)

const route = useRoute()
const router = useRouter()

const weekdayNames = ['一', '二', '三', '四', '五', '六', '日']
const poopTypes = ref([])

function parseMonthFromUrl() {
  const m = route.query.month
  if (typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split('-').map(Number)
    return new Date(y, mo - 1, 1)
  }
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}
const monthStart = ref(parseMonthFromUrl())

watch(monthStart, (val) => {
  const y = val.getFullYear()
  const m = String(val.getMonth() + 1).padStart(2, '0')
  router.replace({ query: { ...route.query, month: `${y}-${m}` } }).catch(() => {})
})
const days = ref([])
const weeks = ref([])
const summary = ref({ totalCount: 0, avgDuration: 0, avgPerDay: 0, typeStats: {} })
const compareWithLastMonth = ref({})
const records = ref([])
const loading = ref(false)
const errorMessage = ref('')
const selectedDay = ref(null)
let typeChart = null
const typeChartCanvas = ref(null)

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
function getPoopTypeCategory(id) {
  const pt = poopTypes.value.find(t => t.id === id)
  return pt ? pt.category : ''
}
function getTypePercent(id) {
  const total = summary.value.totalCount || 0
  if (total === 0) return 0
  return Math.round(((summary.value.typeStats[id] || 0) / total) * 1000) / 10
}

// -------- 健康趋势分析 --------
const healthTrend = computed(() => {
  const recs = records.value
  if (!recs || recs.length === 0) return { constipationDays: 0, diarrheaDays: 0, constipationStreak: 0, diarrheaStreak: 0 }

  // 按日期分组
  const byDate = {}
  recs.forEach(r => {
    const d = String(r.date).slice(0, 10)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(r)
  })

  const dates = Object.keys(byDate).sort()

  // 计算每天的主要状况（基于多数记录）
  const dailyStatus = dates.map(d => {
    const dayRecs = byDate[d]
    // 类型分布
    const typeCounts = { constipation: 0, normal: 0, diarrhea: 0 }
    dayRecs.forEach(r => {
      const t = r.poopType
      if (t === 1 || t === 2) typeCounts.constipation++
      else if (t === 6 || t === 7) typeCounts.diarrhea++
      else typeCounts.normal++
    })
    // 决定当天状况：多数类型决定
    if (typeCounts.constipation > typeCounts.normal && typeCounts.constipation > typeCounts.diarrhea) return 'constipation'
    if (typeCounts.diarrhea > typeCounts.normal && typeCounts.diarrhea > typeCounts.constipation) return 'diarrhea'
    return 'normal'
  })

  // 统计总天数
  const constipationDays = dailyStatus.filter(s => s === 'constipation').length
  const diarrheaDays = dailyStatus.filter(s => s === 'diarrhea').length

  // 计算最长连续天数
  let constipationStreak = 0, currentConstipationStreak = 0
  let diarrheaStreak = 0, currentDiarrheaStreak = 0
  dailyStatus.forEach(s => {
    if (s === 'constipation') {
      currentConstipationStreak++
      constipationStreak = Math.max(constipationStreak, currentConstipationStreak)
      currentDiarrheaStreak = 0
    } else if (s === 'diarrhea') {
      currentDiarrheaStreak++
      diarrheaStreak = Math.max(diarrheaStreak, currentDiarrheaStreak)
      currentConstipationStreak = 0
    } else {
      currentConstipationStreak = 0
      currentDiarrheaStreak = 0
    }
  })

  return { constipationDays, diarrheaDays, constipationStreak, diarrheaStreak }
})

// -------- 季节性统计（最近12个月）--------
const seasonalStats = computed(() => {
  // 使用 days 数据（按天聚合）来计算每月平均
  // days 数组包含每日统计，我们按月份聚合
  const byMonth = {}
  days.value.forEach(d => {
    if (!d.date) return
    const monthKey = d.date.slice(0, 7) // YYYY-MM
    if (!byMonth[monthKey]) byMonth[monthKey] = { total: 0, days: new Set() }
    byMonth[monthKey].total += d.count || 0
    if (d.count > 0) byMonth[monthKey].days.add(d.date)
  })

  const monthLabels = []
  const monthAvgs = []

  // 获取最近12个月
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    const info = byMonth[key]
    monthLabels.push(`${d.getMonth() + 1}月`)
    // 计算日均（如果有数据的话）
    const daysInMonth = info ? info.days.size : 0
    const total = info ? info.total : 0
    monthAvgs.push(daysInMonth > 0 ? Math.round((total / daysInMonth) * 10) / 10 : 0)
  }

  return { labels: monthLabels, avgs: monthAvgs }
})

// -------- 渲染类型分布图表 --------
function renderTypeChart() {
  if (!typeChartCanvas.value) return

  const typeStats = summary.value.typeStats || {}
  const total = summary.value.totalCount || 0
  if (total === 0) return

  // 只显示有数据的类型
  const data = poopTypes.value
    .filter(pt => (typeStats[pt.id] || 0) > 0)
    .map(pt => ({
      label: `${pt.emoji} ${pt.name}`,
      count: typeStats[pt.id] || 0,
      color: pt.category === '便秘' ? '#ef4444' :
             pt.category === '轻微便秘' ? '#f97316' :
             pt.category === '正常' ? '#22c55e' :
             pt.category === '理想' ? '#10b981' :
             pt.category === '缺乏纤维' ? '#eab308' :
             pt.category === '轻度腹泻' ? '#3b82f6' :
             pt.category === '腹泻' ? '#8b5cf6' : '#6b7280'
    }))

  if (typeChart) {
    typeChart.destroy()
    typeChart = null
  }

  typeChart = new Chart(typeChartCanvas.value, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: data.map(d => d.color),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 15, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = Math.round((ctx.raw / total) * 1000) / 10
              return `${ctx.label}: ${ctx.raw}次 (${pct}%)`
            }
          }
        }
      }
    }
  })
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
    // 渲染图表
    await nextTick()
    renderTypeChart()
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

onUnmounted(() => {
  if (typeChart) {
    typeChart.destroy()
    typeChart = null
  }
})
</script>

<style scoped>
.monthly-view { animation: fadeIn 0.4s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.page-title { font-size: 1.5rem; color: var(--color-text); margin-bottom: 1rem; text-align: center; font-weight: 700; }

.month-nav {
  display: flex; flex-wrap: nowrap; align-items: center;
  gap: 0.5rem;
  background: var(--color-surface); padding: 0.75rem 1rem; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm); margin-bottom: 1rem;
}
.arrow-btn {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; min-width: 44px;
  padding: 0.55rem 0.75rem; border: 1px solid var(--color-border);
  background: var(--color-surface); border-radius: var(--radius-md); font-size: 0.9rem; color: var(--color-text-2);
  cursor: pointer; font-weight: 500; white-space: nowrap;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
}
.arrow-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.arrow-btn .arrow-icon { font-size: 1.2rem; line-height: 1; font-weight: 700; }
.arrow-btn .arrow-text { margin: 0 0.25rem; }
.arrow-btn:active { background: var(--color-surface-2); transform: scale(0.97); }
.month-label { flex: 1 1 auto; text-align: center; min-width: 0; }
.month-title { font-weight: 700; color: var(--color-text); font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.month-subtitle { font-size: 0.75rem; color: var(--color-text-3); margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.error-message {
  background: var(--color-danger-soft); color: var(--color-danger-dark); padding: 0.85rem 1rem;
  border-radius: var(--radius-md); margin-bottom: 0.75rem; text-align: center;
  font-size: 0.95rem;
}

.summary-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 1rem;
}
.summary-card {
  border-radius: var(--radius-lg); padding: 0.85rem 0.5rem; color: white; text-align: center;
  box-shadow: var(--shadow-sm);
}
.gradient-1 { background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%); }
.gradient-2 { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.gradient-3 { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.gradient-4 { background: linear-gradient(135deg, #f59e0b 0%, var(--color-danger) 100%); }

.summary-label { font-size: 0.75rem; opacity: 0.95; }
.summary-value { font-size: 1.4rem; font-weight: 800; margin-top: 0.15rem; }
.summary-value.positive { color: #bbf7d0; }
.summary-value.negative { color: #fecaca; }

.calendar {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 1rem;
  box-shadow: var(--shadow-sm); margin-bottom: 1rem;
}

.calendar-weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 0.25rem; margin-bottom: 0.4rem;
}
.weekday {
  text-align: center; font-size: 0.8rem; color: var(--color-text-3); font-weight: 600;
}

.calendar-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.3rem;
}
.calendar-cell {
  aspect-ratio: 1 / 1;
  background: var(--color-surface-2);
  border-radius: var(--radius-md);
  border: 2px solid transparent;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.15rem;
  font-size: 0.9rem; color: var(--color-text-2); font-weight: 600;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease, box-shadow 0.15s var(--ease-default);
  cursor: pointer;
  font-family: inherit;
}
.calendar-cell:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.calendar-cell:disabled { cursor: default; }
.calendar-cell.has-record {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  color: var(--color-primary-dark);
}
.calendar-cell.has-record:hover { transform: translateY(-1px); box-shadow: var(--shadow-primary); background: var(--color-primary); color: var(--color-surface); }
.calendar-cell.has-record:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.calendar-cell.is-selected {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.cell-date { font-size: 0.85rem; }
.cell-count {
  font-size: 0.65rem; background: var(--color-primary); color: var(--color-surface);
  border-radius: 999px; padding: 0.05rem 0.35rem; line-height: 1.4;
}

/* 单日详情弹窗 */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(17, 24, 39, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem; z-index: 50;
}
.modal-card {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 1.25rem 1.25rem 1.5rem;
  width: 100%; max-width: 520px; max-height: 82vh; overflow: hidden;
  display: flex; flex-direction: column; box-shadow: var(--shadow-lg);
  animation: pop-in 0.18s ease-out;
}
@keyframes pop-in {
  from { transform: translateY(8px) scale(0.97); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
.modal-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 0.75rem; border-bottom: 1px solid var(--color-surface-2); margin-bottom: 0.75rem;
}
.modal-title { margin: 0; font-size: 1rem; color: var(--color-text); font-weight: 700; }
.modal-close {
  background: var(--color-surface-2); border: 0; border-radius: var(--radius-md);
  width: 32px; height: 32px; color: var(--color-text-3); font-size: 1rem; cursor: pointer;
  transition: background-color 0.15s var(--ease-default), color 0.15s var(--ease-default);
}
.modal-close:hover { background: var(--color-border); color: var(--color-text); }
.modal-close:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.day-empty { color: var(--color-text-3); text-align: center; padding: 1.5rem 0; }

.day-list { overflow-y: auto; padding-right: 0.25rem; margin-bottom: 0.5rem; }
.day-item {
  background: var(--color-surface-2); border-radius: var(--radius-md); padding: 0.75rem 0.85rem;
  margin-bottom: 0.55rem; display: flex; gap: 0.75rem; align-items: flex-start;
  border: 1px solid var(--color-surface-2);
}
.day-item-main { flex: 1; min-width: 0; }
.day-item-time { font-size: 0.85rem; color: var(--color-text-2); font-weight: 600; }
.day-item-type { font-size: 0.92rem; color: var(--color-text); margin-top: 0.15rem; font-weight: 600; }
.day-item-category { color: var(--color-text-3); font-weight: 500; }
.day-item-duration { color: var(--color-primary); font-weight: 600; }
.day-item-status, .day-item-notes {
  margin-top: 0.25rem; font-size: 0.82rem; color: var(--color-text-2);
  word-break: break-word;
}
.btn-danger {
  background: var(--color-danger-soft); color: var(--color-danger-dark); border: 1px solid var(--color-danger-soft);
  padding: 0.3rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.8rem;
  cursor: pointer; font-weight: 600; flex-shrink: 0;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
}
.btn-danger:focus-visible { outline: 2px solid var(--color-danger); outline-offset: 2px; }
.btn-danger:hover { background: #fecaca; }

.day-summary {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem;
  padding-top: 0.75rem; border-top: 1px dashed var(--color-border); margin-top: 0.5rem;
}
.summary-row {
  display: flex; justify-content: space-between; align-items: baseline;
  background: var(--color-surface-2); padding: 0.5rem 0.75rem; border-radius: var(--radius-md);
  font-size: 0.85rem; color: var(--color-text-2);
}
.summary-row strong { color: var(--color-text); font-size: 1rem; }

.weeks-section, .type-dist, .records-section {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 1rem;
  box-shadow: var(--shadow-sm); margin-bottom: 1rem;
}

.section-title {
  font-size: 1.05rem; color: var(--color-text); margin: 0 0 0.75rem 0; font-weight: 700;
}

.weeks-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
.week-card {
  background: var(--color-surface-2); border-radius: var(--radius-md); padding: 0.75rem;
}
.week-header { font-size: 0.8rem; color: var(--color-primary); font-weight: 600; margin-bottom: 0.35rem; }
.week-body { display: flex; flex-direction: column; gap: 0.35rem; }
.week-meta { display: flex; align-items: baseline; gap: 0.5rem; }
.week-count { font-size: 1.4rem; font-weight: 800; color: var(--color-text); }
.week-avg { font-size: 0.8rem; color: var(--color-text-3); }
.week-types { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.type-chip { background: #e0e7ff; color: var(--color-primary-dark); padding: 0.15rem 0.4rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }

.type-bars { display: flex; flex-direction: column; gap: 0.5rem; }
.type-bar-row { display: grid; grid-template-columns: 110px 1fr 40px; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.type-bar-label { color: var(--color-text-2); font-weight: 500; }
.type-bar-track { background: var(--color-border); height: 12px; border-radius: 999px; overflow: hidden; }
.type-bar-fill {
  background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  height: 100%; border-radius: 999px; transition: width 0.4s ease;
}
.type-bar-value { text-align: right; color: var(--color-text-2); font-weight: 600; }

.records-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.75rem;
}

.btn { padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 600; cursor: pointer; border: 2px solid transparent; min-height: 38px; transition: background-color 0.15s var(--ease-default), transform 0.1s ease; }
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn-outline { background: var(--color-surface); color: var(--color-primary); border-color: var(--color-border-2); }
.btn:active { transform: scale(0.97); }

.export-buttons { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.export-buttons .btn { min-height: 34px; padding: 0.4rem 0.75rem; }

.records-list { display: flex; flex-direction: column; gap: 0.5rem; }
.record-item {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 0.65rem 0.75rem; border-radius: var(--radius-md); background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  transition: box-shadow 0.15s var(--ease-default);
}
.record-item:hover { box-shadow: var(--shadow-sm); }
.record-main { flex: 1; }
.record-time { color: var(--color-primary); font-weight: 600; font-size: 0.85rem; }
.record-type { color: var(--color-primary-dark); font-size: 0.85rem; font-weight: 600; margin-top: 0.1rem; }
.record-category { color: var(--color-text-3); font-weight: 500; }
.record-duration { color: var(--color-text-3); font-weight: 500; }
.record-status { font-size: 0.8rem; color: var(--color-text-2); margin-top: 0.15rem; }
.record-notes { font-size: 0.85rem; color: var(--color-text-2); margin-top: 0.15rem; }

.delete-btn {
  background: var(--color-danger-soft); color: var(--color-danger-dark); border: 1px solid var(--color-danger-soft);
  padding: 0.3rem 0.5rem; border-radius: var(--radius-sm); font-size: 0.75rem;
  font-weight: 600; cursor: pointer; flex-shrink: 0;
  transition: background-color 0.15s var(--ease-default), transform 0.1s ease;
}
.delete-btn:focus-visible { outline: 2px solid var(--color-danger); outline-offset: 2px; }
.delete-btn:hover { background: #fecaca; }
.delete-btn:active { transform: scale(0.97); }

.empty-state {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 3rem 1rem; text-align: center;
  color: var(--color-text-3); box-shadow: var(--shadow-sm); }
.empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }

/* 类型分布图表 */
.chart-container {
  max-width: 320px;
  margin: 0 auto;
}

/* 健康趋势 */
.health-trend-section {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 1rem;
  box-shadow: var(--shadow-sm); margin-bottom: 1rem;
}
.trend-cards {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem;
}
.trend-card {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem; border-radius: var(--radius-md); color: white;
}
.trend-card.constipation { background: linear-gradient(135deg, var(--color-danger) 0%, #f97316 100%); }
.trend-card.diarrhea { background: linear-gradient(135deg, #3b82f6 0%, var(--color-primary-deep) 100%); }
.trend-card.constipation-streak { background: linear-gradient(135deg, #f97316 0%, #eab308 100%); }
.trend-card.diarrhea-streak { background: linear-gradient(135deg, var(--color-primary-deep) 0%, #ec4899 100%); }
.trend-icon { font-size: 1.8rem; }
.trend-info { flex: 1; }
.trend-label { font-size: 0.75rem; opacity: 0.9; }
.trend-value { font-size: 1.25rem; font-weight: 800; }

/* 季节性统计 */
.seasonal-section {
  background: var(--color-surface); border-radius: var(--radius-xl); padding: 1rem;
  box-shadow: var(--shadow-sm); margin-bottom: 1rem;
}
.seasonal-grid {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 0.35rem; height: 80px; padding-top: 0.5rem;
}
.seasonal-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
.seasonal-bar-container { height: 60px; display: flex; align-items: flex-end; }
.seasonal-bar {
  width: 100%; max-width: 24px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  border-radius: 4px 4px 0 0; min-height: 4px;
}
.seasonal-label { font-size: 0.65rem; color: var(--color-text-3); margin-top: 0.25rem; }
.seasonal-value { font-size: 0.7rem; color: var(--color-text-2); font-weight: 600; }

@media (max-width: 720px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .weeks-grid { grid-template-columns: 1fr; }
  .type-bar-row { grid-template-columns: 90px 1fr 40px; font-size: 0.8rem; }
  .summary-value { font-size: 1.25rem; }
  .trend-cards { grid-template-columns: repeat(2, 1fr); }
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

@media (prefers-color-scheme: dark) {
  .month-nav, .calendar, .weeks-section, .type-dist, .records-section,
  .health-trend-section, .seasonal-section, .empty-state, .modal-card {
    background: var(--color-surface);
  }
  .page-title, .month-title, .modal-title, .week-count, .week-header,
  .cell-date, .section-title, .stat-value, .trend-value, .seasonal-value {
    color: var(--color-text);
  }
  .month-subtitle, .week-avg, .seasonal-label, .record-category,
  .record-duration, .day-item-category, .day-empty, .type-bar-label,
  .day-item-duration, .summary-row, .record-status, .record-notes {
    color: var(--color-text-3);
  }
  .arrow-btn, .btn-outline, .modal-close {
    background: var(--color-surface-2);
    border-color: var(--color-border);
    color: var(--color-text);
  }
  .calendar-cell {
    background: var(--color-surface-2);
    color: var(--color-text-2);
  }
  .record-item, .day-item, .week-card, .summary-row {
    background: var(--color-surface-2);
    border-color: var(--color-border);
  }
  .week-card, .summary-row {
    background: var(--color-surface-2);
  }
  .type-bar-track { background: var(--color-border); }
  .delete-btn, .btn-danger {
    background: var(--color-danger-soft);
    border-color: var(--color-danger-soft);
  }
  .error-message {
    background: var(--color-danger-soft);
    color: var(--color-danger-dark);
  }
  .arrow-btn:active { background: var(--color-border); }
}
</style>
