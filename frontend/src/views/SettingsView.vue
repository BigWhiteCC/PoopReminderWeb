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
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.page-title {
  font-size: 1.5rem;
  color: #1f2937;
  margin-bottom: 1.25rem;
  text-align: center;
  font-weight: 700;
}

.settings-card {
  background: white;
  border-radius: 20px;
  padding: 1.5rem 1.25rem 1.75rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.setting-item {
  margin-bottom: 1.5rem;
}

.setting-label {
  display: block;
  font-size: 1rem;
  color: #1f2937;
  margin-bottom: 0.75rem;
  font-weight: 600;
  text-align: center;
}

.time-picker {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.time-select {
  font-size: 1.1rem;
  padding: 0.75rem 1rem;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 600;
  color: #374151;
  min-width: 80px;
  text-align: center;
  -webkit-appearance: none;
  appearance: none;
}

.time-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
}

.time-separator {
  font-size: 1.75rem;
  font-weight: 700;
  color: #667eea;
}

.setting-info {
  background: #eef2ff;
  border-radius: 12px;
  padding: 0.85rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.info-icon {
  font-size: 1.4rem;
  line-height: 1;
  flex-shrink: 0;
}

.setting-info p {
  color: #4338ca;
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.4;
  flex: 1;
}

.save-btn {
  width: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 12px;
  padding: 0.95rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  min-height: 50px;
  -webkit-tap-highlight-color: transparent;
}

.save-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.message {
  margin-top: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  text-align: center;
  font-size: 0.9rem;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.success {
  background: #d1fae5;
  color: #065f46;
}

.message.error {
  background: #fee2e2;
  color: #991b1b;
}

.tips-card {
  background: white;
  border-radius: 20px;
  padding: 1.25rem 1.25rem 1.5rem;
  margin-top: 1.25rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.tips-card h3 {
  color: #1f2937;
  margin-bottom: 0.75rem;
  font-size: 1.05rem;
  font-weight: 700;
}

.tips-card ul {
  margin: 0;
  padding-left: 1.25rem;
  color: #4b5563;
  line-height: 1.7;
  font-size: 0.95rem;
}

.tips-card li {
  margin-bottom: 0.2rem;
}

/* 小屏（<=480px） */
@media (max-width: 480px) {
  .page-title {
    font-size: 1.3rem;
  }

  .settings-card {
    padding: 1.25rem 1rem 1.5rem;
    border-radius: 18px;
  }

  .setting-label {
    font-size: 0.95rem;
    margin-bottom: 0.6rem;
  }

  .time-select {
    font-size: 1rem;
    padding: 0.65rem 0.75rem;
    min-width: 64px;
  }

  .time-separator {
    font-size: 1.5rem;
  }

  .setting-info {
    padding: 0.75rem 0.85rem;
    gap: 0.5rem;
  }

  .info-icon {
    font-size: 1.2rem;
  }

  .setting-info p {
    font-size: 0.9rem;
  }

  .save-btn {
    font-size: 1rem;
    padding: 0.85rem;
    min-height: 48px;
  }

  .tips-card {
    padding: 1.1rem 1rem 1.25rem;
    border-radius: 18px;
  }

  .tips-card h3 {
    font-size: 1rem;
  }

  .tips-card ul {
    font-size: 0.9rem;
    padding-left: 1.1rem;
  }
}
</style>
