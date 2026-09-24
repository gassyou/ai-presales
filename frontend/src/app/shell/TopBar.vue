<!--
  TopBar.vue
  ==========
  工作台顶部栏（浅色商务风）
  - 左侧：品牌标语
  - 中间：版本号
  - 右侧：菜单（路由跳转）+ API 健康状态指示
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
      <span class="text-xs text-slate-400">v{{ health?.version ?? "0.0.0" }}</span>
    </div>

    <div class="flex items-center gap-2">
      <nav class="flex items-center gap-1">
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.routeName }"
          class="rounded-md px-2.5 py-1 text-slate-700 transition-colors hover:bg-surface-sunken"
          exact-active-class="bg-accent-soft text-accent-ink font-medium"
        >
          {{ item.label }}
        </router-link>
      </nav>

      <el-tag
        v-if="health"
        :type="health.checks.db === 'ok' || health.checks.db === 'skipped' ? 'success' : 'danger'"
        size="small"
        effect="light"
        :title="healthTitle"
      >
        <span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
        {{ healthLabel }}
      </el-tag>
      <el-tag v-else size="small" effect="light" type="info">离线</el-tag>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchHealth, type HealthInfo } from "@frontend/shared/api/health.api";

interface NavItem {
  name: string;
  label: string;
  routeName: string;
}

const navItems: NavItem[] = [
  { name: "dashboard", label: "仪表盘", routeName: "dashboard" },
  { name: "projects", label: "项目列表", routeName: "projects" },
  { name: "settings", label: "系统设置", routeName: "settings" },
];

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
