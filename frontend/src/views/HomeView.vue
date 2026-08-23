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
        <!-- 随机笑话卡片：填充上半部分空白 -->
        <div v-if="currentJoke" class="joke-card" :class="{ 'joke-loading': jokeLoading }">
          <div class="joke-header">
            <span class="joke-emoji">🤣</span>
            <span class="joke-title">拉屎看笑话 · 时间过得快</span>
            <button class="joke-refresh" type="button" @click="loadJoke" :disabled="jokeLoading" aria-label="换一个笑话">
              {{ jokeLoading ? '加载中…' : '换一个' }}
            </button>
          </div>
          <div class="joke-content">{{ currentJoke }}</div>
        </div>
        <div v-else class="joke-card joke-loading">
          <div class="joke-skeleton"></div>
          <div class="joke-skeleton short"></div>
        </div>

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

// 随机笑话：屎图标上方填充内容
const currentJoke = ref('')
const jokeLoading = ref(false)

// 本地备用笑话库（联网失败时使用，保证任何情况都能看到笑话）
const LOCAL_JOKES = [
  '为什么程序员总喜欢黑暗模式？因为光吸引 bug。',
  '面试官：你最大的缺点是什么？我：诚实。面试官：我不觉得诚实是缺点啊。我：我无所谓你怎么想。',
  '医生说我有严重的强迫症，我说：医生，得是 10 分才行。',
  '我朋友说他要去北极开火锅店，我说那生意得多冷啊？他说：没事，反正都是凉的。',
  '为什么海是蓝色的？因为鱼在里面吐泡泡：blue～ blue～',
  '我问我爸：“爸，我是不是你亲生的？” 我爸：“你再不好好学习，就不是了。”',
  '有人问我如何在这个混乱的世界保持冷静？我：我一般假装没看见。',
  '医生：“你这病，得戒游戏。” 我：“那我先戒什么？” 医生：“先戒谢罪。”',
  '顾客：老板，这菜里怎么有只虫子？老板：别怕，它已经撑死了，吃不了你多少。',
  '朋友问我最近锻炼怎么样了，我说我每天都做 100 个仰卧起坐——早上从床上爬起来 1 个，晚上躺下 1 个，其余 98 个是在刷短视频的时候翻白眼做的。',
  '我问老婆：“如果我和你妈同时掉进水里，你先救谁？” 她说：“你先救我妈，我自拍一张。”',
  '为什么数学书里都是忧郁的故事？因为它们都有太多的问题。',
  '老板：你被开除了！员工：为什么？老板：你不觉得你每天都来得太晚了吗？员工：我每天都在家把闹钟摁早了啊。',
  '我决定不再拖延了，打算明天就开始改这个毛病。',
  '小时候我以为长大后就可以熬夜，长大后发现熬夜真的是成年人的权利，但代价是第二天的一整天。',
  '减肥成功的秘诀是什么？答：把嘴闭上，把腿打开。（我说的是跑步）',
  '我的钱包和我本人一样，看起来很空，但里面全是故事（主要是欠别人的）。',
  '今天我问镜子里的自己：“你到底行不行啊？” 镜子没说话，但它给我比了个中指。',
  '人生就像拉屎，有时候你很努力了，结果出来的只是个屁。',
  '拉屎的时候看笑话，据说通便效果+30%，时间过得+50%，快乐指数+100%。',
  '我不是在摸鱼，我是在进行「创造性发呆」。',
  '我不是胖，我只是骨架大——外面包了一层厚厚的肉。',
  '有朋友问我如何在一年内攒够 10 万？我答：很简单，先存 20 万，然后花一半。',
  '每次看到别人发朋友圈：今天又瘦了 2 斤。我就知道，她刚刚把屎拉完了。',
  '我妈说我一无是处，我立刻回嘴：不对，我至少还会“事后诸葛亮”。',
  '有一天我说我要早起，结果我的闹钟同意了，我的身体拒绝了，我的灵魂在旁边嗑瓜子。'
]

/**
 * 从多个公共笑话API中随机取一个；失败则回退到本地库。
 * 网络API的内容是纯文本，便于直接展示。
 */
async function fetchRemoteJoke() {
  const endpoints = [
    // 笑话集：随机返回一条
    async () => {
      const res = await fetch('https://api.apiopen.top/api/getJoke?size=1', { cache: 'no-store' })
      if (!res.ok) throw new Error('api1 fail')
      const json = await res.json()
      const text = json?.result?.[0]?.text || json?.result?.[0]?.content || json?.message
      if (!text || typeof text !== 'string') throw new Error('api1 empty')
      return text.trim()
    },
    // 小歪API：随机一句话/笑话，需要解析
    async () => {
      const res = await fetch('https://api.ixiaowai.cn/twts.php', { cache: 'no-store' })
      if (!res.ok) throw new Error('api2 fail')
      const text = await res.text()
      const clean = (text || '').replace(/<[^>]+>/g, '').trim()
      if (!clean) throw new Error('api2 empty')
      return clean
    },
    // 韩韩API - 土味/笑话
    async () => {
      const res = await fetch('https://api.vvhan.com/api/text/joke?type=text', { cache: 'no-store' })
      if (!res.ok) throw new Error('api3 fail')
      const text = await res.text()
      const clean = (text || '').replace(/<[^>]+>/g, '').trim()
      if (!clean) throw new Error('api3 empty')
      return clean
    },
    // 一言 Hitokoto 作为备用（不是严格的笑话，但有趣且稳定）
    async () => {
      const res = await fetch('https://v1.hitokoto.cn/?c=a&c=d&c=i&c=k&encode=text', { cache: 'no-store' })
      if (!res.ok) throw new Error('api4 fail')
      const text = await res.text()
      const clean = (text || '').trim()
      if (!clean) throw new Error('api4 empty')
      return clean
    }
  ]

  // 打乱顺序，避免总从同一个API开始
  const shuffled = [...endpoints].sort(() => Math.random() - 0.5)
  let lastErr = null
  for (const fn of shuffled) {
    try {
      // 设置 3.5s 超时，避免网络卡顿影响体验
      const result = await Promise.race([
        fn(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3500))
      ])
      if (result && result.length >= 4 && result.length <= 400) return result
    } catch (e) { lastErr = e }
  }
  if (lastErr) throw lastErr
  throw new Error('all joke endpoints failed')
}

function getLocalJoke() {
  const idx = Math.floor(Math.random() * LOCAL_JOKES.length)
  return LOCAL_JOKES[idx]
}

async function loadJoke({ forceRemote = false } = {}) {
  jokeLoading.value = true
  try {
    // 如果不强制走网络，先给一个本地笑话（秒开，避免闪烁），
    // 之后在后台异步替换成网络笑话。
    let hasLocal = false
    if (!forceRemote) {
      currentJoke.value = getLocalJoke()
      hasLocal = true
    }
    try {
      const remote = await fetchRemoteJoke()
      if (remote) currentJoke.value = remote
    } catch (_) {
      // 网络失败：如果之前没塞本地笑话，这里补一次
      if (!hasLocal) currentJoke.value = getLocalJoke()
    }
  } finally {
    jokeLoading.value = false
  }
}

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
    loadJoke() // 恢复会话后也要刷新笑话（页面刷新后的新内容）
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
    loadJoke() // 每次点击"开始拉屎"都刷新笑话
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
/* 笑话卡片：填充倒计时上方空白 */
.joke-card {
  position: relative;
  background: linear-gradient(135deg, #fff8e6 0%, #fff1d6 100%);
  border: 1.5px solid #ffd98a;
  border-radius: var(--radius-lg);
  padding: 0.9rem 1rem 1rem 1rem;
  margin: 0 0.25rem 1rem 0.25rem;
  text-align: left;
  box-shadow: 0 4px 14px rgba(255, 170, 70, 0.15);
  animation: jokeIn 0.35s ease;
}
@keyframes jokeIn {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.joke-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.55rem;
}
.joke-emoji {
  font-size: 1.15rem;
  line-height: 1;
  animation: giggle 1.8s infinite ease-in-out;
}
@keyframes giggle {
  0%, 100% { transform: rotate(0deg) scale(1); }
  25%      { transform: rotate(-8deg) scale(1.08); }
  75%      { transform: rotate(8deg) scale(1.08); }
}
.joke-title {
  flex: 1;
  color: #92480a;
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.5px;
}
.joke-refresh {
  appearance: none;
  border: 1px solid #ffcb6b;
  background: rgba(255,255,255,0.7);
  color: #92480a;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), transform 0.1s var(--ease-default);
  -webkit-tap-highlight-color: transparent;
}
.joke-refresh:active:not(:disabled) { transform: scale(0.95); }
.joke-refresh:disabled { opacity: 0.6; cursor: progress; }
.joke-refresh:hover:not(:disabled) { background: #fff; }

.joke-content {
  color: #5d3508;
  font-size: 0.92rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 2.4em;
}

/* 骨架屏：笑话未加载完时的占位 */
.joke-skeleton {
  width: 100%;
  height: 0.85rem;
  background: linear-gradient(90deg, #ffe8b8 0%, #fff2d1 50%, #ffe8b8 100%);
  background-size: 200% 100%;
  border-radius: 6px;
  margin: 0.5rem 0;
  animation: skeletonShimmer 1.4s linear infinite;
}
.joke-skeleton.short { width: 60%; }
@keyframes skeletonShimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
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
