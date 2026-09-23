<!--
  DashboardView.vue
  =================
  仪表盘主页（阶段 7.4g）：
    - slogan
    - 三张 KPI 卡：本月新增 / 年度中标 / 年度未中标 / 历史总
    - 月度柱状图（3 系列：新增/中标/未中标，可切年份）
    - 待推进活动 TOP5 表
    - 刷新按钮 + 数据截止时间
-->
<template>
  <section class="mx-auto flex h-full max-w-7xl flex-col gap-4 p-6">
    <!-- Slogan：浅色商务卡（深色背景 + 浅文字 对比度差，改用 accent 渐变浅底 + 深字） -->
    <div class="rounded-lg border border-border bg-gradient-to-r from-accent-soft via-white to-surface-alt px-5 py-6">
      <h1 class="text-xl font-semibold text-slate-900">
        让每一份提案都切中要点，深入人心，让每一个案件都能中标
      </h1>
      <p class="mt-1 text-sm text-slate-600">
        AI 驱动的提案协助工作台
      </p>
    </div>

    <div v-if="store.error" class="rounded border border-rose-700 bg-rose-50 px-3 py-2 text-xs text-rose-700">
      加载失败：{{ store.error }}
    </div>

    <!-- KPI 卡 -->
    <div class="grid grid-cols-4 gap-3">
      <StatCard title="本月新增案件" :value="store.summary?.monthNew ?? '--'" />
      <StatCard title="本年度中标数" :value="store.summary?.yearWon ?? '--'" />
      <StatCard title="本年度未中标数" :value="store.summary?.yearLost ?? '--'" />
      <StatCard title="历史总案件数" :value="store.summary?.total ?? '--'" />
    </div>

    <!-- 月度图 + 活动表 -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MonthlyChart
        :stats="store.monthly"
        :year="currentYear"
        :loading="store.loading && store.monthly.length === 0"
        @change-year="onChangeYear"
      />
      <UpcomingActivities
        :activities="store.upcoming"
        :limit="store.upcomingLimit"
        :loading="store.loading && store.upcoming.length === 0"
        :as-of="store.summary?.asOf"
      />
    </div>

    <!-- 底部：刷新按钮 + 截止时间 -->
    <footer class="flex items-center justify-end gap-3 text-xs text-slate-500">
      <span v-if="store.summary?.asOf">截至 {{ formatAsOf(store.summary.asOf) }}</span>
      <button
        class="rounded border border-border px-3 py-1 text-slate-700 hover:bg-surface-alt disabled:opacity-40"
        :disabled="store.loading"
        @click="onRefresh"
      >
        {{ store.loading ? "刷新中…" : "刷新" }}
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import StatCard from "./components/StatCard.vue";
import MonthlyChart from "./components/MonthlyChart.vue";
import UpcomingActivities from "./components/UpcomingActivities.vue";
import { useDashboardStore } from "./stores/dashboard.store.ts";

const store = useDashboardStore();

// 当前显示年份：优先 store.year，其次从月份数据推断（首条记录 month=1）
const currentYear = computed(() => {
  if (store.year !== null) return store.year;
  // 兜底：用 summary.asOf 的年（loadAll 并行时 year 还没 set，但 asOf 已返回）
  if (store.summary?.asOf) {
    return new Date(store.summary.asOf).getFullYear();
  }
  return new Date().getFullYear();
});

onMounted(async () => {
  await store.loadAll();
});

async function onRefresh(): Promise<void> {
  await store.refresh();
}

async function onChangeYear(year: number): Promise<void> {
  await store.changeYear(year);
}

function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>
