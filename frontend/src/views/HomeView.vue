<template>
  <div class="home-view">
    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>

    <div class="streak-card">
      <div class="streak-icon">🔥</div>
      <div class="streak-number">{{ streak }}</div>
      <div class="streak-label">连续打卡天数</div>
    </div>

    <div class="record-section">
      <button class="record-btn" @click="handleRecord" :disabled="isRecording">
        <span class="btn-icon">💩</span>
        <span class="btn-text">{{ isRecording ? '记录中...' : '我拉屎了' }}</span>
      </button>

      <div class="notes-input">
        <input
          v-model="notes"
          type="text"
          placeholder="添加备注（可选）"
          class="notes-field"
        />
      </div>
    </div>

    <div class="recent-section">
      <h2 class="section-title">最近记录</h2>
      <div v-if="records.length === 0" class="empty-state">
        <div class="empty-icon">📝</div>
        <p>暂无记录，开始你的第一次打卡吧！</p>
      </div>
      <div v-else class="records-list">
        <div v-for="record in records" :key="record.id" class="record-item">
          <div class="record-time">{{ formatDate(record.date) }}</div>
          <div v-if="record.notes" class="record-notes">{{ record.notes }}</div>
          <div v-if="record.device" class="record-device">
            📱 {{ record.device.model || record.device.type }} · {{ record.device.os }} · {{ record.device.browser }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api, ApiError } from '../services/api'

const streak = ref(0)
const records = ref([])
const notes = ref('')
const isRecording = ref(false)
const errorMessage = ref('')

function showError(message) {
  errorMessage.value = message
  setTimeout(() => {
    errorMessage.value = ''
  }, 3000)
}

async function loadData() {
  try {
    const data = await api.getHomeData()
    streak.value = data.streak
    records.value = data.records
  } catch (err) {
    if (err instanceof ApiError) {
      showError(`加载数据失败: ${err.message}`)
    } else {
      showError('加载数据失败，请稍后重试')
    }
    console.error('加载数据失败:', err)
  }
}

async function handleRecord() {
  if (isRecording.value) return
  isRecording.value = true
  try {
    await api.addRecord(notes.value)
    notes.value = ''
    await loadData()
  } catch (err) {
    if (err instanceof ApiError) {
      showError(`记录失败: ${err.message}`)
    } else {
      showError('记录失败，请稍后重试')
    }
    console.error('记录失败:', err)
  } finally {
    isRecording.value = false
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.home-view {
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.error-message {
  background: #fee;
  color: #c33;
  padding: 1rem;
  border-radius: 12px;
  margin-bottom: 1rem;
  text-align: center;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.streak-card {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  border-radius: 24px;
  padding: 2.5rem;
  text-align: center;
  color: white;
  box-shadow: 0 10px 40px rgba(245, 87, 108, 0.3);
  margin-bottom: 2rem;
}

.streak-icon {
  font-size: 4rem;
  margin-bottom: 0.5rem;
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.streak-number {
  font-size: 5rem;
  font-weight: 800;
  line-height: 1;
  text-shadow: 0 4px 20px rgba(0,0,0,0.2);
}

.streak-label {
  font-size: 1.2rem;
  opacity: 0.9;
  margin-top: 0.5rem;
}

.record-section {
  background: white;
  border-radius: 20px;
  padding: 2rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  margin-bottom: 2rem;
  text-align: center;
}

.record-btn {
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  border: none;
  border-radius: 50px;
  padding: 1.2rem 3rem;
  font-size: 1.3rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 8px 30px rgba(56, 239, 125, 0.4);
  transition: all 0.3s ease;
}

.record-btn:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 12px 40px rgba(56, 239, 125, 0.5);
}

.record-btn:active:not(:disabled) {
  transform: translateY(0);
}

.record-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1.5rem;
}

.notes-input {
  margin-top: 1.5rem;
}

.notes-field {
  width: 100%;
  max-width: 300px;
  padding: 0.8rem 1.2rem;
  border: 2px solid #e0e0e0;
  border-radius: 25px;
  font-size: 1rem;
  text-align: center;
  transition: all 0.3s ease;
}

.notes-field:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
}

.section-title {
  font-size: 1.3rem;
  color: #333;
  margin-bottom: 1rem;
  padding-left: 0.5rem;
  border-left: 4px solid #667eea;
}

.empty-state {
  background: #f8f9fa;
  border-radius: 16px;
  padding: 3rem;
  text-align: center;
  color: #666;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.records-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.record-item {
  background: white;
  border-radius: 16px;
  padding: 1.2rem;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  transition: all 0.3s ease;
}

.record-item:hover {
  transform: translateX(5px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}

.record-time {
  color: #667eea;
  font-weight: 600;
  font-size: 0.95rem;
}

.record-notes {
  color: #444;
  margin-top: 0.5rem;
  font-size: 0.95rem;
}

.record-device {
  color: #999;
  font-size: 0.85rem;
  margin-top: 0.5rem;
  font-style: italic;
}
</style>
