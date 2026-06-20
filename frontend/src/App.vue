<template>
  <div id="app">
    <nav v-if="!isLoginRoute" class="navbar">
      <div class="nav-brand">拉屎提醒</div>
      <div class="nav-links">
        <router-link to="/" class="nav-link">首页</router-link>
        <router-link to="/weekly" class="nav-link">周</router-link>
        <router-link to="/monthly" class="nav-link">月</router-link>
        <router-link to="/history" class="nav-link">明细</router-link>
        <router-link to="/settings" class="nav-link">设置</router-link>
        <router-link v-if="isAdmin" to="/admin" class="nav-link nav-link--admin">🛡 管理</router-link>
        <button @click="handleLogout" class="logout-btn">退出</button>
      </div>
    </nav>
    <main class="main-content" :class="{ 'full-height': isLoginRoute }">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isLoginRoute = computed(() => route.name === 'login')

const isAdmin = computed(() => {
  try {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      const u = JSON.parse(userStr)
      return u.role === 'admin'
    }
  } catch (e) {}
  return false
})

const handleLogout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login'
}
</script>

<style scoped>
  .navbar {
    position: sticky;
    top: 0;
    z-index: 50;
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-deep) 100%);
    padding: 0.8rem 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: var(--shadow-primary);
  }

  .nav-brand {
    font-size: 1.25rem;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }

  .nav-links {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: nowrap;
  }

  .nav-link {
    color: rgba(255, 255, 255, 0.92);
    text-decoration: none;
    font-weight: 500;
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-pill);
    font-size: 0.95rem;
    transition: background-color 0.15s var(--ease-default);
    white-space: nowrap;
  }

  .nav-link:hover,
  .nav-link.router-link-active {
    background: rgba(255, 255, 255, 0.22);
    color: white;
  }

  .nav-link--admin {
    background: rgba(255, 255, 255, 0.18);
    font-weight: 600;
  }

  .nav-link--admin:hover,
  .nav-link--admin.router-link-active {
    background: rgba(255, 255, 255, 0.35);
  }

  .logout-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    font-weight: 500;
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    font-size: 0.95rem;
    transition: background-color 0.15s var(--ease-default);
    white-space: nowrap;
    font-family: inherit;
  }

  .logout-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .logout-btn:focus-visible {
    outline: 2px solid white;
    outline-offset: 2px;
  }

  .main-content {
    flex: 1;
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    padding: 1rem 1rem 2rem;
  }

  .main-content.full-height {
    width: 100%;
    max-width: 100%;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;
    min-height: 100vh;
    min-height: 100dvh;
  }

  /* 小屏优化 */
  @media (max-width: 640px) {
    .navbar { padding: 0.65rem 0.75rem; }
    .nav-brand { font-size: 1.1rem; }
    .nav-links { gap: 0.25rem; }
    .nav-link, .logout-btn { padding: 0.4rem 0.6rem; font-size: 0.85rem; }
    .main-content { padding: 0.8rem 0.75rem 2rem; }
  }

  /* 超小屏 */
  @media (max-width: 380px) {
    .nav-link, .logout-btn { padding: 0.35rem 0.45rem; font-size: 0.8rem; }
    .nav-brand { font-size: 1rem; }
  }
</style>
