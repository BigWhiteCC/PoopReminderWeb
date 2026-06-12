<template>
  <div class="settings-view">
    <h1 class="page-title">⚙️ 提醒设置</h1>

    <div class="settings-card">
      <div class="setting-item">
        <label class="setting-label">每日提醒时间</label>
        <div class="time-picker">
          <select v-model="hour" class="time-select">
            <option v-for="h in 24" :key="h-1" :value="h-1">
              {{ String(h-1).padStart(2, '0') }}
            </option>
          </select>
          <span class="time-separator">:</span>
          <select v-model="minute" class="time-select">
            <option v-for="m in 60" :key="m-1" :value="m-1">
              {{ String(m-1).padStart(2, '0') }}
            </option>
          </select>
        </div>
      </div>

      <div class="setting-info">
        <div class="info-icon">💡</div>
        <p>每天 {{ formattedTime }} 会收到提醒通知</p>
      </div>

      <button class="save-btn" @click="handleSave" :disabled="saving">
        {{ saving ? '保存中...' : '保存设置' }}
      </button>

      <div v-if="message" class="message" :class="messageType">
        {{ message }}
      </div>
    </div>

    <div class="tips-card">
      <h3>💪 使用提示</h3>
      <ul>
        <li>保持规律排便对健康很重要</li>
        <li>建议每天固定时间排便</li>
        <li>记得多吃蔬菜水果，多喝水</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, ApiError } from '../services/api'

const hour = ref(8)
const minute = ref(0)
const saving = ref(false)
const message = ref('')
const messageType = ref('success')

const formattedTime = computed(() => {
  return `${String(hour.value).padStart(2, '0')}:${String(minute.value).padStart(2, '0')}`
})

async function loadSettings() {
  try {
    const data = await api.getSettings()
    hour.value = data.hour
    minute.value = data.minute
  } catch (err) {
    if (err instanceof ApiError) {
      message.value = `加载设置失败: ${err.message}`
      messageType.value = 'error'
    } else {
      message.value = '加载设置失败，请稍后重试'
      messageType.value = 'error'
    }
    console.error('加载设置失败:', err)
    setTimeout(() => {
      message.value = ''
    }, 3000)
  }
}

async function handleSave() {
  saving.value = true
  message.value = ''
  try {
    await api.updateSettings(hour.value, minute.value)
    message.value = '设置已保存！'
    messageType.value = 'success'
  } catch (err) {
    if (err instanceof ApiError) {
      message.value = `保存失败: ${err.message}`
      messageType.value = 'error'
    } else {
      message.value = '保存失败，请稍后重试'
      messageType.value = 'error'
    }
    console.error('保存设置失败:', err)
  } finally {
    saving.value = false
    setTimeout(() => {
      message.value = ''
    }, 3000)
  }
}

onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.settings-view {
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.page-title {
  font-size: 1.8rem;
  color: #333;
  margin-bottom: 1.5rem;
  text-align: center;
}

.settings-card {
  background: white;
  border-radius: 20px;
  padding: 2rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.setting-item {
  margin-bottom: 2rem;
}

.setting-label {
  display: block;
  font-size: 1.1rem;
  color: #333;
  margin-bottom: 1rem;
  font-weight: 500;
}

.time-picker {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.time-select {
  font-size: 1.5rem;
  padding: 0.8rem 1.2rem;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition: all 0.3s ease;
}

.time-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
}

.time-separator {
  font-size: 2rem;
  font-weight: 700;
  color: #667eea;
}

.setting-info {
  background: #f0f4ff;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1.5rem;
}

.info-icon {
  font-size: 1.5rem;
}

.setting-info p {
  color: #667eea;
  margin: 0;
  font-size: 0.95rem;
}

.save-btn {
  width: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 12px;
  padding: 1rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.save-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.message {
  margin-top: 1rem;
  padding: 0.8rem;
  border-radius: 8px;
  text-align: center;
  font-size: 0.95rem;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.success {
  background: #d4edda;
  color: #155724;
}

.message.error {
  background: #f8d7da;
  color: #721c24;
}

.tips-card {
  background: white;
  border-radius: 20px;
  padding: 1.5rem;
  margin-top: 1.5rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.tips-card h3 {
  color: #333;
  margin-bottom: 1rem;
  font-size: 1.1rem;
}

.tips-card ul {
  margin: 0;
  padding-left: 1.5rem;
  color: #666;
  line-height: 1.8;
}

.tips-card li {
  margin-bottom: 0.3rem;
}
</style>
