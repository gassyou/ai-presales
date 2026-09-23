<!--
  StatCard.vue
  ============
  仪表盘统计卡片占位
-->
<template>
  <div class="card flex flex-col gap-1">
    <div class="text-xs text-slate-600">{{ title }}</div>
    <div class="text-2xl font-semibold tabular-nums text-slate-900">{{ value }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  value: string | number;
}>();
</script>