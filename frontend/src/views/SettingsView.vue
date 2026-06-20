<template>
  <div class="settings-view">
    <h1 class="page-title">⚙️ 提醒设置</h1>

    <div class="settings-card">
      <div class="setting-item">
        <label for="reminder-hour" class="setting-label">每日提醒时间 - 小时</label>
        <div class="time-picker">
          <select id="reminder-hour" v-model="hour" class="time-select" aria-label="小时">
            <option v-for="h in 24" :key="h-1" :value="h-1">
              {{ String(h-1).padStart(2, '0') }}
            </option>
          </select>
          <span class="time-separator">:</span>
          <select id="reminder-minute" v-model="minute" class="time-select" aria-label="分钟">
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

    <!-- 修改密码 -->
    <div class="settings-card password-card">
      <h3 class="card-title">🔐 修改密码</h3>

      <div class="form-group">
        <label for="pwd-old">旧密码</label>
        <input id="pwd-old" v-model="pwdForm.oldPassword" type="password" placeholder="请输入旧密码" class="form-input" autocomplete="current-password" spellcheck="false" />
      </div>

      <div class="form-group">
        <label for="pwd-new">新密码</label>
        <input id="pwd-new" v-model="pwdForm.newPassword" type="password" placeholder="至少6位" class="form-input" autocomplete="new-password" spellcheck="false" />
      </div>

      <div class="form-group">
        <label for="pwd-confirm">确认新密码</label>
        <input id="pwd-confirm" v-model="pwdForm.confirmPassword" type="password" placeholder="再次输入新密码" class="form-input" autocomplete="new-password" spellcheck="false" />
      </div>
      
      <button class="save-btn pwd-btn" @click="handlePasswordChange" :disabled="pwdSaving">
        {{ pwdSaving ? '修改中...' : '修改密码' }}
      </button>
      
      <div v-if="pwdMessage" class="message" :class="pwdMessageType">
        {{ pwdMessage }}
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
import { ref, computed, onMounted, reactive } from 'vue'
import { api, ApiError } from '../services/api'

const hour = ref(8)
const minute = ref(0)
const saving = ref(false)
const message = ref('')
const messageType = ref('success')

// 密码修改相关
const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const pwdSaving = ref(false)
const pwdMessage = ref('')
const pwdMessageType = ref('success')

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

async function handlePasswordChange() {
  pwdMessage.value = ''
  
  // 前端校验
  if (!pwdForm.oldPassword) {
    pwdMessage.value = '请输入旧密码'
    pwdMessageType.value = 'error'
    return
  }
  if (!pwdForm.newPassword || pwdForm.newPassword.length < 6) {
    pwdMessage.value = '新密码至少6位'
    pwdMessageType.value = 'error'
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    pwdMessage.value = '两次输入的新密码不一致'
    pwdMessageType.value = 'error'
    return
  }
  
  pwdSaving.value = true
  try {
    await api.changePassword(pwdForm.oldPassword, pwdForm.newPassword)
    pwdMessage.value = '密码修改成功！'
    pwdMessageType.value = 'success'
    // 清空表单
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
  } catch (err) {
    if (err instanceof ApiError) {
      pwdMessage.value = err.message
    } else {
      pwdMessage.value = '修改失败，请稍后重试'
    }
    pwdMessageType.value = 'error'
  } finally {
    pwdSaving.value = false
    setTimeout(() => {
      pwdMessage.value = ''
    }, 3000)
  }
}

onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.settings-view {
  animation: fadeIn 0.4s var(--ease-default);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.page-title {
  font-size: 1.5rem;
  color: var(--color-text);
  margin-bottom: 1.25rem;
  text-align: center;
  font-weight: 700;
}

.settings-card {
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  padding: 1.5rem 1.25rem 1.75rem;
  box-shadow: var(--shadow-md);
}

.setting-item {
  margin-bottom: 1.5rem;
}

.setting-label {
  display: block;
  font-size: 1rem;
  color: var(--color-text);
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
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  font-weight: 600;
  color: var(--color-text-2);
  min-width: 80px;
  text-align: center;
  -webkit-appearance: none;
  appearance: none;
}

.time-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
}

.time-select:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.time-separator {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-primary);
}

.setting-info {
  background: var(--color-primary-soft);
  border-radius: var(--radius-md);
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
  color: var(--color-primary-dark);
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.4;
  flex: 1;
}

.save-btn {
  width: 100%;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  border: none;
  border-radius: var(--radius-md);
  padding: 0.95rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: white;
  cursor: pointer;
  transition: filter 0.15s var(--ease-default), transform 0.1s var(--ease-default), box-shadow 0.15s var(--ease-default);
  box-shadow: var(--shadow-primary);
  min-height: 50px;
  -webkit-tap-highlight-color: transparent;
  font-family: inherit;
}

.save-btn:hover:not(:disabled) { filter: brightness(1.05); }
.save-btn:active:not(:disabled) { transform: scale(0.98); }
.save-btn:disabled { opacity: 0.7; cursor: not-allowed; }
.save-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.message {
  margin-top: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: var(--radius-sm);
  text-align: center;
  font-size: 0.9rem;
  animation: slideIn 0.3s var(--ease-default);
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.success {
  background: var(--color-success-soft);
  color: var(--color-success-dark);
}

.message.error {
  background: var(--color-danger-soft);
  color: var(--color-danger-dark);
}

.tips-card {
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  padding: 1.25rem 1.25rem 1.5rem;
  margin-top: 1.25rem;
  box-shadow: var(--shadow-md);
}

.tips-card h3 {
  color: var(--color-text);
  margin-bottom: 0.75rem;
  font-size: 1.05rem;
  font-weight: 700;
}

.tips-card ul {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--color-text-2);
  line-height: 1.7;
  font-size: 0.95rem;
}

.tips-card li {
  margin-bottom: 0.2rem;
}

/* 修改密码卡片 */
.password-card {
  margin-top: 1.25rem;
}

.card-title {
  color: var(--color-text);
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1rem;
  text-align: center;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.9rem;
  color: var(--color-text-2);
  font-weight: 500;
  margin-bottom: 0.4rem;
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 1rem;
  background: var(--color-surface);
  color: var(--color-text);
  transition: border-color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  box-sizing: border-box;
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.12);
}

.form-input:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.pwd-btn {
  margin-top: 0.5rem;
}

/* 暗模式 */
@media (prefers-color-scheme: dark) {
  .settings-card,
  .tips-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }

  .time-select,
  .form-input {
    background: var(--color-bg);
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .setting-info { background: var(--color-primary-soft); }
  .message.success { background: var(--color-success-soft); }
  .message.error { background: var(--color-danger-soft); }
}

/* 小屏（<=480px） */
@media (max-width: 480px) {
  .page-title { font-size: 1.3rem; }
  .settings-card { padding: 1.25rem 1rem 1.5rem; border-radius: 18px; }
  .setting-label { font-size: 0.95rem; margin-bottom: 0.6rem; }
  .time-select { font-size: 1rem; padding: 0.65rem 0.75rem; min-width: 64px; }
  .time-separator { font-size: 1.5rem; }
  .setting-info { padding: 0.75rem 0.85rem; gap: 0.5rem; }
  .info-icon { font-size: 1.2rem; }
  .setting-info p { font-size: 0.9rem; }
  .save-btn { font-size: 1rem; padding: 0.85rem; min-height: 48px; }
  .tips-card { padding: 1.1rem 1rem 1.25rem; border-radius: 18px; }
  .tips-card h3 { font-size: 1rem; }
}
</style>
