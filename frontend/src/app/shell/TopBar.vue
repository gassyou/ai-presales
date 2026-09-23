<!--
  TopBar.vue
  ==========
  工作台顶部栏（浅色商务风）
  - 左侧：品牌标语
  - 中间：当前路径面包屑
  - 右侧：API 健康状态指示
-->
<template>
  <header
    class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-white px-3 text-sm"
  >
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5 text-slate-800">
        <div class="h-2 w-2 rounded-full bg-accent" />
        <span class="font-semibold">AI 售前智能平台</span>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <span
        v-if="health"
        :class="[
          'tag',
          health.checks.db === 'ok' || health.checks.db === 'skipped'
            ? 'tag-success'
            : 'tag-error',
        ]"
        :title="healthTitle"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-current" />
        {{ healthLabel }}
      </span>
      <span class="text-xs text-slate-400">v{{ health?.version ?? "0.0.0" }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { fetchHealth, type HealthInfo } from "@frontend/shared/api/health.api";

const route = useRoute();
const pageTitle = computed(() => (route.name as string | undefined) ?? "工作台");

const health = ref<HealthInfo | null>(null);

onMounted(async () => {
  try {
    health.value = await fetchHealth();
  } catch {
    health.value = null;
  }
});

const healthLabel = computed(() => {
  if (!health.value) return "离线";
  return health.value.status === "ok" ? "在线" : "异常";
});

const healthTitle = computed(() => {
  if (!health.value) return "无法连接后端";
  return `db=${health.value.checks.db} llm=${health.value.checks.llm} providers=${
    health.value.checks.providers.join(",")
  }`;
});
</script>