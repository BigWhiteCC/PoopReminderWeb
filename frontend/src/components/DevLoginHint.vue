<template>
  <div class="dev-hint">
    <span class="dev-hint-label">开发模式</span>
    <button type="button" class="dev-hint-btn" @click="onFill">
      一键填充：test / test123
    </button>
  </div>
</template>

<script setup>
import { defineEmits } from 'vue'

const emit = defineEmits(['fill'])
const onFill = () => emit('fill')
</script>

<style scoped>
.dev-hint {
  margin-top: clamp(0.75rem, 2vw, 1.25rem);
  padding: 0.65rem 0.85rem;
  background: rgba(102, 126, 234, 0.08);
  border: 1px dashed rgba(102, 126, 234, 0.45);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: clamp(0.8rem, 2vw, 0.9rem);
  color: #4338ca;
}

.dev-hint-label {
  font-weight: 700;
  letter-spacing: 0.03em;
}

.dev-hint-btn {
  border: none;
  background: none;
  color: #4338ca;
  text-decoration: underline;
  cursor: pointer;
  padding: 0 0.2rem;
  font-size: inherit;
  font-weight: 600;
}

.dev-hint-btn:hover {
  color: #312e81;
}
</style>
