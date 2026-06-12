<template>
  <div id="app">
    <nav class="navbar">
      <div class="nav-brand">💩 拉屎提醒</div>
      <div class="nav-links">
        <router-link to="/" class="nav-link">首页</router-link>
        <router-link to="/history" class="nav-link">历史</router-link>
        <router-link to="/settings" class="nav-link">设置</router-link>
        <button @click="handleLogout" class="logout-btn">退出登录</button>
      </div>
    </nav>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
const handleLogout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login'
}
</script>

<style scoped>
.navbar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
}

.nav-brand {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 2px 10px rgba(0,0,0,0.2);
}

.nav-links {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.nav-link {
  color: rgba(255,255,255,0.9);
  text-decoration: none;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  transition: all 0.3s ease;
}

.nav-link:hover,
.nav-link.router-link-active {
  background: rgba(255,255,255,0.2);
  color: white;
}

.logout-btn {
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.logout-btn:hover {
  background: rgba(255,255,255,0.3);
}

.main-content {
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}
</style>