<template>
  <div class="history-view">
    <h1 class="page-title">📜 历史记录</h1>

    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>

    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>加载中...</p>
    </div>

    <div v-else-if="records.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <p>暂无历史记录</p>
    </div>

    <div v-else class="records-grid">
      <div v-for="record in records" :key="record.id" class="record-card">
        <div class="record-header">
          <span class="record-date">{{ formatDate(record.date) }}</span>
          <button class="delete-btn" @click="handleDelete(record.id)">
            🗑️
          </button>
        </div>
        <div v-if="record.notes" class="record-notes">{{ record.notes }}</div>
        <div v-if="record.device" class="record-device">
          <span class="device-icon">📱</span>
          <span class="device-info">
            {{ record.device.model || record.device.type }} · {{ record.device.os }} · {{ record.device.browser }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api, ApiError } from '../services/api'

const records = ref([])
const loading = ref(true)
const errorMessage = ref('')

function showError(message) {
  errorMessage.value = message
  setTimeout(() => {
    errorMessage.value = ''
  }, 3000)
}

async function loadData() {
  loading.value = true
  try {
    const data = await api.getHistory()
    records.value = data.records
  } catch (err) {
    if (err instanceof ApiError) {
      showError(`加载历史失败: ${err.message}`)
    } else {
      showError('加载历史失败，请稍后重试')
    }
    console.error('加载历史失败:', err)
  } finally {
    loading.value = false
  }
}

async function handleDelete(id) {
  if (!confirm('确定要删除这条记录吗？')) return
  try {
    await api.deleteRecord(id)
    await loadData()
  } catch (err) {
    if (err instanceof ApiError) {
      showError(`删除失败: ${err.message}`)
    } else {
      showError('删除失败，请稍后重试')
    }
    console.error('删除失败:', err)
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.history-view {
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

.loading {
  text-align: center;
  padding: 3rem;
  color: #666;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.empty-state {
  background: #f8f9fa;
  border-radius: 20px;
  padding: 4rem 2rem;
  text-align: center;
  color: #666;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.records-grid {
  display: grid;
  gap: 1rem;
}

.record-card {
  background: white;
  border-radius: 16px;
  padding: 1.2rem;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  transition: all 0.3s ease;
}

.record-card:hover {
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}

.record-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.record-date {
  color: #667eea;
  font-weight: 600;
  font-size: 1rem;
}

.delete-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.delete-btn:hover {
  background: #fee;
  transform: scale(1.1);
}

.record-notes {
  color: #444;
  margin: 0.5rem 0;
  padding: 0.5rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.record-device {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  color: #888;
  font-size: 0.85rem;
}

.device-icon {
  font-size: 1rem;
}
</style>
