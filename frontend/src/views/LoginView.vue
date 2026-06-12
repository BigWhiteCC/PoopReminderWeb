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
          />
        </div>

        <div class="form-group">
          <label for="email">邮箱</label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            placeholder="请输入邮箱"
            class="form-input"
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
          />
        </div>

        <button type="submit" class="auth-btn" :disabled="isLoading">
          <span v-if="isLoading" class="loading">加载中...</span>
          <span v-else>{{ isLogin ? '登录' : '注册' }}</span>
        </button>

        <div v-if="error" class="error-message">{{ error }}</div>
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
import { ref, reactive, computed } from 'vue'
import { api, ApiError } from '../services/api'

const isLogin = ref(true)
const isLoading = ref(false)
const error = ref('')

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
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem;
}

.auth-card {
  background: white;
  border-radius: 24px;
  padding: 2.5rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.auth-header {
  text-align: center;
  margin-bottom: 2rem;
}

.logo {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.auth-header h1 {
  color: #333;
  font-size: 1.8rem;
  margin-bottom: 0.5rem;
}

.auth-header p {
  color: #666;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  color: #555;
  font-weight: 500;
  font-size: 0.9rem;
}

.form-input {
  padding: 0.9rem 1.2rem;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  font-size: 1rem;
  transition: all 0.3s ease;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
}

.auth-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 12px;
  padding: 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-top: 0.5rem;
}

.auth-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.auth-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.error-message {
  color: #ef4444;
  text-align: center;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.auth-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
  color: #666;
  font-size: 0.9rem;
}

.switch-btn {
  background: none;
  border: none;
  color: #667eea;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.switch-btn:hover {
  color: #764ba2;
}
</style>