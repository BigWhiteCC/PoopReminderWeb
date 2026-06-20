<template>
  <div class="home-view">
    <div v-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </div>

    <div v-if="!isPooping" class="streak-card">
      <div class="streak-icon">🔥</div>
      <div class="streak-number">{{ streak }}</div>
      <div class="streak-label">连续打卡天数</div>
    </div>

    <!-- 正常打卡区：两阶段按钮，自动计时 -->
    <div class="record-section">
      <h3 v-if="!isPooping" class="section-title-small">准备好就开始吧</h3>
      <div v-if="isPooping" class="timer-display">
        <div class="timer-icon">💩</div>
        <div class="timer-value">{{ formattedElapsed }}</div>
        <div class="timer-label">正在拉屎中...</div>
      </div>

      <!-- 拉屎中：选择类型 + 拉完了按钮 -->
      <div v-if="isPooping" class="poop-type-grid" role="radiogroup" aria-label="选择大便类型">
        <button
          v-for="pt in poopTypes" :key="pt.id"
          type="button"
          class="poop-type-item"
          :class="{ active: selectedPoopType === pt.id }"
          role="radio"
          :aria-checked="selectedPoopType === pt.id"
          :aria-label="pt.name + '，' + pt.description"
          @click="selectedPoopType = pt.id"
        >
          <span class="poop-type-emoji" aria-hidden="true">{{ pt.emoji }}</span>
          <span class="poop-type-name">{{ pt.name }}</span>
          <span class="poop-type-desc">{{ pt.description }}</span>
        </button>
      </div>

      <div v-if="isPooping" class="poop-actions">
        <button
          class="record-btn btn-cancel"
          :disabled="isSaving"
          @click="handleCancel"
        >
          <span class="btn-icon">✖</span>
          <span class="btn-text">取消</span>
        </button>
        <button
          class="record-btn btn-stop"
          :disabled="isSaving"
          @click="handleMainButton"
        >
          <span class="btn-icon">✅</span>
          <span class="btn-text">{{ isSaving ? '保存中...' : '拉完了' }}</span>
        </button>
      </div>

      <button
        v-else
        class="record-btn btn-start"
        :disabled="isSaving"
        @click="handleMainButton"
      >
        <span class="btn-icon">💩</span>
        <span class="btn-text">开始拉屎</span>
      </button>
    </div>

    <!-- 补充记录弹窗 -->
    <div v-if="showSupplement" class="modal-overlay" @click.self="showSupplement = false" @keydown.esc="showSupplement = false">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="supplement-title" tabindex="-1">
        <h3 id="supplement-title" class="modal-title">补充记录</h3>

        <label for="supplement-date" class="input-label full">
          开始时间
          <input
            id="supplement-date"
            type="datetime-local"
            v-model="supplement.date"
            :max="supplementMax"
            class="input-field"
            @focus="onSupplementDateFocus"
          />
          <span class="input-hint">不允许选择今天之后的时间</span>
        </label>

        <label for="supplement-duration" class="input-label">
          持续时长（分钟，可填小数，如 3.5 = 3分30秒）
          <input
            id="supplement-duration"
            type="number" min="0" max="1440" step="0.01"
            v-model="supplement.duration"
            class="input-field"
            placeholder="分钟，例如 3.5"
            autocomplete="off"
          />
        </label>

        <div class="input-label full">大便类型</div>
        <div class="poop-type-grid small" role="radiogroup" aria-label="选择大便类型">
          <button
            v-for="pt in poopTypes" :key="pt.id"
            type="button"
            class="poop-type-item"
            :class="{ active: supplement.poopType === pt.id }"
            role="radio"
            :aria-checked="supplement.poopType === pt.id"
            :aria-label="pt.name + '，' + pt.description"
            @click="supplement.poopType = pt.id"
          >
            <span class="poop-type-emoji" aria-hidden="true">{{ pt.emoji }}</span>
            <span class="poop-type-name">{{ pt.name }}</span>
            <span class="poop-type-desc">{{ pt.description }}</span>
          </button>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" @click="showSupplement = false">取消</button>
          <button class="btn-primary" @click="handleSupplementSave" :disabled="isSaving">
            {{ isSaving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div class="recent-section">
      <div class="recent-header">
        <h2 class="section-title">最近记录</h2>
        <span class="record-count">共 {{ records.length }} 条</span>
        <button class="supplement-inline-btn" @click="openSupplement">
          <span>📝</span>
          <span>补充记录</span>
        </button>
      </div>

      <div v-if="records.length === 0" class="empty-state">
        <div class="empty-icon">📝</div>
        <p>暂无记录，开始你的第一次打卡吧！</p>
      </div>

      <div v-else class="records-list">
        <div v-for="record in records" :key="record.id" class="record-item">
          <div class="record-time">{{ formatDate(record.date) }}</div>
          <div class="record-poop-type">
            {{ getPoopTypeEmoji(record.poopType) }} {{ getPoopTypeName(record.poopType) }}
            <span v-if="getPoopTypeCategory(record.poopType)" class="record-category">（{{ getPoopTypeCategory(record.poopType) }}）</span>
            <span v-if="record.duration" class="record-duration"> · {{ formatDuration(record.duration) }}</span>
          </div>
          <div v-if="record.device" class="record-device">
            📱 {{ record.device.model || record.device.type }} · {{ record.device.os }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { api, ApiError, formatDuration } from '../services/api'

const poopTypes = ref([])
const streak = ref(0)
const records = ref([])
const selectedPoopType = ref(4)
const errorMessage = ref('')

const isPooping = ref(false)
const isSaving = ref(false)
const startTime = ref(null)
const elapsedSeconds = ref(0)
let ticker = null

// 补充记录：日期/时刻上限为“此刻”，按浏览器 datetime-local 要求的 YYYY-MM-DDTHH:mm 格式。
// 使用 computed 保证每次模板访问都取到最新的当前时间，避免用户在弹窗停留过程中
// 选到已经过期的时间点。
function toDatetimeLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const supplementMax = computed(() => toDatetimeLocal())
// 本地日期 key（YYYY-MM-DD）用于“今天之后的日期”判断
function toLocalDateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const POOP_SESSION_KEY = 'poop_reminder_session'

function saveSession() {
  if (!isPooping.value) return
  try {
    localStorage.setItem(POOP_SESSION_KEY, JSON.stringify({
      startTime: startTime.value,
      selectedPoopType: selectedPoopType.value
    }))
  } catch (e) {}
}

function clearSession() {
  try { localStorage.removeItem(POOP_SESSION_KEY) } catch (e) {}
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(POOP_SESSION_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    if (!data || !data.startTime) return false
    const now = Date.now()
    const elapsed = Math.floor((now - data.startTime) / 1000)
    if (elapsed < 0 || elapsed > 4 * 3600) {
      clearSession()
      return false
    }
    isPooping.value = true
    startTime.value = data.startTime
    if (data.selectedPoopType) selectedPoopType.value = data.selectedPoopType
    elapsedSeconds.value = Math.floor(elapsed)
    startTicker(true)
    return true
  } catch (e) {
    clearSession()
    return false
  }
}

const showSupplement = ref(false)
const supplement = reactive({
  poopType: 4,
  duration: 5,
  date: ''
})

const formattedElapsed = computed(() => {
  const s = elapsedSeconds.value
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
})

function showError(message) {
  errorMessage.value = message
  setTimeout(() => { errorMessage.value = '' }, 3500)
}

async function loadPoopTypes() {
  try {
    const data = await api.getPoopTypes()
    poopTypes.value = data.types
  } catch (err) { console.error(err) }
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
  try {
    const data = await api.getHomeData()
    streak.value = data.streak
    records.value = (data.records || []).slice(0, 10)
  } catch (err) {
    if (err instanceof ApiError) showError(`加载失败: ${err.message}`)
    else showError('加载失败，请稍后重试')
  }
}

function startTicker(resuming = false) {
  if (!resuming) {
    startTime.value = Date.now()
    elapsedSeconds.value = 0
    saveSession()
  }
  if (ticker) clearInterval(ticker)
  ticker = setInterval(() => {
    elapsedSeconds.value = Math.floor((Date.now() - startTime.value) / 1000)
  }, 1000)
}

function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null }
}

function handleCancel() {
  stopTicker()
  isPooping.value = false
  selectedPoopType.value = 4
  elapsedSeconds.value = 0
  startTime.value = null
  clearSession()
}

async function handleMainButton() {
  if (isSaving.value) return
  if (!isPooping.value) {
    isPooping.value = true
    startTicker()
    return
  }
  if (!selectedPoopType.value) {
    showError('请先选择大便类型')
    return
  }
  isSaving.value = true
  stopTicker()
  try {
    const durationSec = Math.max(0, Math.floor(elapsedSeconds.value))
    await api.addRecord({
      poop_type: selectedPoopType.value,
      duration: durationSec
    })
    isPooping.value = false
    selectedPoopType.value = 4
    elapsedSeconds.value = 0
    startTime.value = null
    clearSession()
    await loadData()
  } catch (err) {
    if (err instanceof ApiError) showError(`记录失败: ${err.message}`)
    else showError('记录失败，请稍后重试')
  } finally {
    isSaving.value = false
  }
}

function openSupplement() {
  // 默认填充当前时间
  const now = new Date()
  supplement.date = toDatetimeLocal(now)
  supplement.poopType = 4
  supplement.duration = 5
  showSupplement.value = true
}

// 用户点击输入框时：若当前值超过“此刻”，重置为新的当前时间，
// 确保浏览器原生时间选择器一弹出就限制到今天及之前。
function onSupplementDateFocus() {
  const max = supplementMax.value
  if (!supplement.date || supplement.date > max) {
    supplement.date = max
  }
}

async function handleSupplementSave() {
  if (!supplement.poopType) { showError('请选择大便类型'); return }
  if (!supplement.date) { showError('请选择开始时间'); return }
  // 不允许选择“今天之后”的时间（按本地日期判断）
  const localDate = new Date(supplement.date)
  if (isNaN(localDate.getTime())) { showError('开始时间无效'); return }
  const todayKey = toLocalDateKey()
  const pickedKey = toLocalDateKey(localDate)
  if (pickedKey > todayKey) {
    showError('开始时间不能晚于今天')
    return
  }
  // 同一天内也不允许超过当前时刻（更严格）
  if (pickedKey === todayKey) {
    const now = new Date()
    now.setSeconds(0, 0)
    if (localDate.getTime() > now.getTime()) {
      showError('开始时间不能晚于现在')
      return
    }
  }
  isSaving.value = true
  try {
    const durationMinutes = Number(supplement.duration) || 0
    const duration = Math.max(0, Math.round(durationMinutes * 60)) // 分钟 -> 秒
    await api.addRecord({
      poop_type: supplement.poopType,
      duration,
      date: localDate.toISOString()
    })
    showSupplement.value = false
    await loadData()
  } catch (err) {
    if (err instanceof ApiError) showError(`记录失败: ${err.message}`)
    else showError('记录失败，请稍后重试')
  } finally {
    isSaving.value = false
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

onMounted(() => {
  restoreSession()
  loadPoopTypes()
  loadData()
})

watch(selectedPoopType, () => {
  if (isPooping.value) saveSession()
})

watch(isPooping, (val) => {
  if (val) saveSession()
  else clearSession()
})

onBeforeUnmount(() => {
  stopTicker()
})
</script>

<style scoped>
.home-view { animation: fadeIn 0.5s ease; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.error-message {
  background: var(--color-danger-soft);
  color: var(--color-danger-dark);
  padding: 0.85rem 1rem;
  border-radius: var(--radius-md);
  margin-bottom: 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.streak-card {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  border-radius: var(--radius-xl);
  padding: 1.5rem 1.25rem;
  text-align: center;
  color: white;
  box-shadow: 0 10px 40px rgba(245, 87, 108, 0.3);
  margin-bottom: 1.25rem;
}

.streak-icon { font-size: 2.5rem; margin-bottom: 0.25rem; animation: bounce 2s infinite; }

@keyframes bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

.streak-number { font-size: 3.25rem; font-weight: 800; line-height: 1; }
.streak-label { font-size: 1rem; opacity: 0.92; margin-top: 0.35rem; }

.record-section {
  background: white;
  border-radius: var(--radius-xl);
  padding: 1.25rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  margin-bottom: 1.25rem;
}

.section-title-small {
  text-align: center;
  color: var(--color-text-2);
  font-weight: 500;
  font-size: 0.95rem;
  margin: 0 0 1rem 0;
}

.timer-display {
  text-align: center; padding: 1rem 0 1.25rem 0;
}
.timer-icon { font-size: 3rem; margin-bottom: 0.5rem; animation: pulse 1.2s infinite; }
.timer-value { font-size: 2.5rem; font-weight: 800; color: var(--color-primary); letter-spacing: 2px; }
.timer-label { font-size: 0.9rem; color: var(--color-text-3); margin-top: 0.25rem; }

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
}

.poop-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}
.poop-type-grid.small { margin-bottom: 1rem; }

.poop-type-item {
  background: var(--color-surface);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.75rem 0.35rem;
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  text-align: center;
  min-height: 92px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  -webkit-tap-highlight-color: transparent;
}
.poop-type-item:active { transform: scale(0.97); }
.poop-type-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.poop-type-item.active {
  background: var(--color-primary);
  color: white;
  box-shadow: var(--shadow-primary);
}

.poop-type-emoji { font-size: 1.75rem; line-height: 1.2; margin-bottom: 0.2rem; }
.poop-type-name { font-weight: 700; font-size: 0.9rem; line-height: 1.2; margin-bottom: 0.15rem; }
.poop-type-desc { font-size: 0.7rem; opacity: 0.75; line-height: 1.25; }

.poop-actions {
  display: flex; gap: 0.6rem; margin-top: 0.25rem;
}
.poop-actions .record-btn {
  flex: 1;
  min-height: 52px;
  font-size: 1.05rem;
}

.record-btn {
  width: 100%;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  border: none;
  border-radius: var(--radius-md);
  padding: 1rem 1.5rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-shadow: var(--shadow-primary);
  transition: background-color 0.15s var(--ease-default), color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  min-height: 56px;
  -webkit-tap-highlight-color: transparent;
}
.record-btn:active:not(:disabled) { transform: scale(0.98); }
.record-btn:disabled { opacity: 0.7; cursor: not-allowed; }
.record-btn.btn-stop {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  box-shadow: var(--shadow-primary);
}
.record-btn.btn-cancel {
  background: #fff;
  color: var(--color-text-2);
  border: 2px solid var(--color-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}
.record-btn.btn-cancel:active:not(:disabled) { border-color: var(--color-text-4); }
.record-btn.btn-start {
  flex: 1;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  box-shadow: var(--shadow-primary);
}
.record-btn.btn-supplement {
  flex: 1;
  background: #fff;
  color: var(--color-text-2);
  border: 2px solid var(--color-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}
.record-btn.btn-supplement:hover { border-color: var(--color-primary); color: var(--color-primary); }
.record-btn.btn-supplement:active { transform: scale(0.97); }

.start-row {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.25rem;
}
.start-row .record-btn {
  flex: 1;
  min-height: 56px;
  font-size: 1.05rem;
}
.btn-icon { font-size: 1.35rem; }

.quick-icon { font-size: 1rem; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}
.modal-card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding: 1.25rem;
  max-height: 85vh;
  overflow-y: auto;
  animation: slideUp 0.25s ease;
  box-shadow: 0 -10px 40px rgba(0,0,0,0.15);
}
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.modal-title {
  margin: 0 0 1rem 0;
  font-size: 1.1rem;
  text-align: center;
  color: var(--color-text);
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}
.btn-primary, .btn-secondary {
  flex: 1;
  border: none;
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  -webkit-tap-highlight-color: transparent;
}
.btn-primary {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  color: #fff;
  box-shadow: var(--shadow-primary);
}
.btn-primary:disabled { opacity: 0.7; cursor: not-allowed; }
.btn-secondary {
  background: var(--color-surface-2);
  color: var(--color-text-2);
}
.btn-primary:active:not(:disabled), .btn-secondary:active { transform: scale(0.98); }

.extra-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.input-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--color-text-2);
  font-weight: 500;
  margin-bottom: 0.75rem;
}
.input-label.full { grid-column: 1 / -1; }

.input-field {
  width: 100%;
  padding: 0.7rem 0.9rem;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.95rem;
  transition: background-color 0.15s var(--ease-default), color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  -webkit-appearance: none;
  background: #fff;
  box-sizing: border-box;
}
.input-field:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
}
.input-hint {
  font-size: 0.75rem;
  color: var(--color-text-3);
  font-weight: 400;
  line-height: 1.3;
}

.recent-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}
.section-title {
  font-size: 1.1rem;
  color: var(--color-text);
  padding-left: 0.4rem;
  border-left: 4px solid var(--color-primary);
  font-weight: 700;
  margin: 0;
}
.record-count { color: var(--color-text-3); font-size: 0.85rem; }

.supplement-inline-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: #fff;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-2);
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  -webkit-tap-highlight-color: transparent;
}
.supplement-inline-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.supplement-inline-btn:active { transform: scale(0.97); }

.empty-state {
  background: white;
  border-radius: var(--radius-lg);
  padding: 2.5rem 1rem;
  text-align: center;
  color: var(--color-text-3);
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
}
.empty-icon { font-size: 2.5rem; margin-bottom: 0.5rem; }

.records-list { display: flex; flex-direction: column; gap: 0.75rem; }

.record-item {
  background: white;
  border-radius: var(--radius-md);
  padding: 0.9rem 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}

.record-time { color: var(--color-primary); font-weight: 600; font-size: 0.95rem; }
.record-poop-type {
  color: var(--color-primary-deep);
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 0.3rem;
}
.record-category { color: var(--color-text-3); font-weight: 500; }
.record-duration { color: var(--color-text-3); font-weight: 500; }
.record-status { color: var(--color-text-2); margin-top: 0.3rem; font-size: 0.85rem; }
.record-notes { color: var(--color-text-2); margin-top: 0.3rem; font-size: 0.9rem; }
.record-device { color: var(--color-text-4); font-size: 0.75rem; margin-top: 0.3rem; }

@media (max-width: 480px) {
  .streak-card { padding: 1.25rem 1rem; border-radius: var(--radius-xl); }
  .streak-number { font-size: 2.75rem; }
  .record-section { padding: 1rem; }
  .section-title { font-size: 1.05rem; }
}

@media (prefers-color-scheme: dark) {
  .streak-card {
    background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary-deep) 100%);
    box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
  }
  .record-section {
    background: var(--color-surface-2);
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }
  .timer-value { color: var(--color-primary); }
  .timer-label { color: var(--color-text-2); }
  .poop-type-item { background: var(--color-surface); color: var(--color-text); }
  .poop-type-item.active {
    background: var(--color-primary);
    color: white;
    box-shadow: var(--shadow-primary);
  }
  .record-btn.btn-cancel,
  .record-btn.btn-supplement {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border-2);
  }
  .modal-card {
    background: var(--color-surface-2);
    box-shadow: 0 -10px 40px rgba(0,0,0,0.3);
  }
  .modal-title { color: var(--color-text); }
  .btn-secondary { background: var(--color-surface); color: var(--color-text); }
  .input-label { color: var(--color-text-2); }
  .input-field {
    background: var(--color-surface);
    border-color: var(--color-border-2);
    color: var(--color-text);
  }
  .recent-section .section-title { color: var(--color-text); }
  .empty-state {
    background: var(--color-surface-2);
    color: var(--color-text-3);
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  }
  .records-list .record-item {
    background: var(--color-surface-2);
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  }
  .record-poop-type { color: var(--color-primary); }
  .supplement-inline-btn {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border-2);
  }
}
</style>
