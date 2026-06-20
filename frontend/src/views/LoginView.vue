<template>
  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-header">
        <div class="logo">💩</div>
        <h1>{{ isLogin ? '登录' : '注册' }}</h1>
        <p>{{ isLogin ? '欢迎回来！' : '创建新账号' }}</p>
      </div>

      <form @submit.prevent="handleSubmit" class="auth-form">
        <div v-if="!isLogin" class="form-group">
          <label for="username">用户名</label>
          <input
            id="username"
            v-model="form.username"
            type="text"
            placeholder="请输入用户名"
            class="form-input"
            autocomplete="username"
            spellcheck="false"
          />
        </div>

        <div class="form-group">
          <label for="email">{{ isLogin ? '账号（邮箱或用户名）' : '邮箱' }}</label>
          <input
            id="email"
            v-model="form.email"
            :type="isLogin ? 'text' : 'email'"
            :placeholder="isLogin ? '输入邮箱或用户名' : '请输入邮箱'"
            class="form-input"
            autocomplete="username"
            spellcheck="false"
          />
        </div>

        <div class="form-group">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            class="form-input"
            autocomplete="current-password"
            spellcheck="false"
          />
        </div>

        <div v-if="!isLogin" class="form-group">
          <label for="confirmPassword">确认密码</label>
          <input
            id="confirmPassword"
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            class="form-input"
            autocomplete="new-password"
            spellcheck="false"
          />
        </div>

        <button type="submit" class="auth-btn" :disabled="isLoading">
          <span v-if="isLoading" class="loading">加载中...</span>
          <span v-else>{{ isLogin ? '登录' : '注册' }}</span>
        </button>

        <component :is="DevHint" v-if="isLogin" @fill="fillTestAccount" />

        <div v-if="error" class="error-message" role="alert">{{ error }}</div>
      </form>

      <div class="auth-switch">
        <span>{{ isLogin ? '还没有账号？' : '已有账号？' }}</span>
        <button @click="toggleMode" class="switch-btn">
          {{ isLogin ? '立即注册' : '立即登录' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, defineAsyncComponent } from 'vue'
import { api, ApiError } from '../services/api'

const isLogin = ref(true)
const isLoading = ref(false)
const error = ref('')

let DevHint = null
let fillTestAccount = () => {}
if (import.meta.env.DEV) {
  DevHint = defineAsyncComponent(() => import('../components/DevLoginHint.vue'))
  fillTestAccount = () => {
    form.email = 'test'
    form.password = 'test123'
    error.value = ''
  }
}

const form = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: ''
})

const toggleMode = () => {
  isLogin.value = !isLogin.value
  error.value = ''
  form.username = ''
  form.email = ''
  form.password = ''
  form.confirmPassword = ''
}

const handleSubmit = async () => {
  error.value = ''

  if (!isLogin.value) {
    if (!form.username.trim()) {
      error.value = '请输入用户名'
      return
    }
    if (!form.email.trim()) {
      error.value = '请输入邮箱'
      return
    }
    if (!form.password) {
      error.value = '请输入密码'
      return
    }
    if (form.password !== form.confirmPassword) {
      error.value = '两次输入的密码不一致'
      return
    }
  } else {
    if (!form.email.trim()) {
      error.value = '请输入邮箱'
      return
    }
    if (!form.password) {
      error.value = '请输入密码'
      return
    }
  }

  isLoading.value = true

  try {
    let result
    if (isLogin.value) {
      result = await api.login(form.email, form.password)
    } else {
      result = await api.register(form.username, form.email, form.password)
    }

    localStorage.setItem('token', result.token)
    localStorage.setItem('user', JSON.stringify(result.user))

    window.location.href = '/'
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.message
    } else {
      error.value = '操作失败，请稍后重试'
    }
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.auth-container {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  padding: 1.5rem clamp(0.75rem, 3vw, 2rem);
  box-sizing: border-box;
}

.auth-card {
  background: white;
  border-radius: var(--radius-xl);
  padding: clamp(1.5rem, 4vw, 2.5rem) clamp(1.25rem, 4vw, 2.25rem);
  width: 100%;
  max-width: min(420px, 100%);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}

.auth-header {
  text-align: center;
  margin-bottom: clamp(1rem, 3vw, 1.75rem);
}

.logo {
  font-size: clamp(2.5rem, 7vw, 3.5rem);
  margin-bottom: 0.75rem;
  line-height: 1;
}

.auth-header h1 {
  color: var(--color-text);
  font-size: clamp(1.25rem, 3.5vw, 1.75rem);
  margin-bottom: 0.4rem;
}

.auth-header p {
  color: var(--color-text-3);
  font-size: clamp(0.85rem, 2.2vw, 1rem);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: clamp(0.75rem, 2vw, 1.1rem);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-group label {
  color: var(--color-text-2);
  font-weight: 500;
  font-size: clamp(0.8rem, 2vw, 0.95rem);
}

.form-input {
  width: 100%;
  padding: clamp(0.7rem, 2vw, 0.95rem) 1rem;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: clamp(0.9rem, 2.3vw, 1.05rem);
  color: var(--color-text);
  background: #ffffff;
  transition: border-color 0.15s var(--ease-default), box-shadow 0.15s var(--ease-default);
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--shadow-primary);
}

.auth-btn {
  width: 100%;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
  border: none;
  border-radius: var(--radius-md);
  padding: clamp(0.75rem, 2vw, 1rem);
  font-size: clamp(0.95rem, 2.3vw, 1.1rem);
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: background-color 0.15s var(--ease-default), transform 0.15s var(--ease-default), opacity 0.15s var(--ease-default);
  margin-top: 0.25rem;
  min-height: 48px;
  -webkit-tap-highlight-color: transparent;
}

.auth-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.auth-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.error-message {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-sm);
  text-align: center;
  font-size: clamp(0.8rem, 2vw, 0.95rem);
  margin-top: 0.25rem;
  line-height: 1.4;
}

.auth-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-top: clamp(1rem, 2.5vw, 1.5rem);
  color: var(--color-text-3);
  font-size: clamp(0.8rem, 2vw, 0.95rem);
  flex-wrap: wrap;
}

.switch-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  font-weight: 600;
  cursor: pointer;
  padding: 0.25rem 0.4rem;
  font-size: inherit;
}

.switch-btn:active {
  opacity: 0.7;
}

/* 竖向小屏：让卡片顶对齐，避免被系统顶部条遮挡 */
@media (max-width: 480px) {
  .auth-container {
    padding: 1rem 0.75rem;
    align-items: flex-start;
    padding-top: 3vh;
  }

  .auth-card {
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  }
}

/* 横屏短高度时，允许卡片缩小并可滚动 */
@media (max-height: 560px) {
  .auth-container {
    align-items: flex-start;
    padding: 1rem;
  }
}

/* 暗模式 */
@media (prefers-color-scheme: dark) {
  .auth-card {
    background: #1f2937;
  }

  .auth-header h1 {
    color: #f9fafb;
  }

  .auth-header p {
    color: #9ca3af;
  }

  .form-group label {
    color: #d1d5db;
  }

  .form-input {
    background: #374151;
    color: #f9fafb;
    border-color: #4b5563;
  }

  .form-input::placeholder {
    color: #6b7280;
  }

  .form-input:focus {
    border-color: var(--color-primary);
  }

  .error-message {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.15);
  }

  .auth-switch {
    color: #9ca3af;
  }
}
</style>