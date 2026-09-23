<!--
  UpcomingActivities.vue
  ======================
  待推进活动 TOP N 表（阶段 7.4g）。
  列：计划日期 / 主题 / 案件 / 客户 / 客户主负责人
  行点击 → 跳转到对应项目详情页（无项目则禁用）。
-->
<template>
  <div class="card flex flex-col gap-2">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-800">最近需要推进活动 (TOP {{ limit }})</h2>
      <span v-if="asOf" class="text-xs text-slate-500">截至 {{ formatAsOf(asOf) }}</span>
    </header>

    <div v-if="loading" class="px-4 py-8 text-center text-xs text-slate-500">加载中…</div>
    <div v-else-if="activities.length === 0" class="px-4 py-8 text-center text-xs text-slate-500">
      没有需要推进的活动（pending + 计划日期 ≥ 今天）
    </div>
    <table v-else class="w-full text-xs">
      <thead>
        <tr class="text-slate-500">
          <th class="px-2 py-1 text-left">计划日期</th>
          <th class="px-2 py-1 text-left">主题</th>
          <th class="px-2 py-1 text-left">案件</th>
          <th class="px-2 py-1 text-left">客户</th>
          <th class="px-2 py-1 text-left">客户主负责人</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="a in activities"
          :key="a.id"
          class="cursor-pointer border-t border-border hover:bg-surface-alt/40"
          @click="goProject(a.projectId)"
        >
          <td class="px-2 py-1 tabular-nums text-slate-700">{{ formatDate(a.planDate) }}</td>
          <td class="px-2 py-1 text-slate-900">{{ a.title }}</td>
          <td class="px-2 py-1 text-slate-700">{{ a.projectName }}</td>
          <td class="px-2 py-1 text-slate-700">{{ a.clientName }}</td>
          <td class="px-2 py-1 text-slate-600">{{ a.clientContactName || "—" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import type { UpcomingActivity } from "../api/dashboard.api.ts";

defineProps<{
  activities: UpcomingActivity[];
  limit: number;
  loading?: boolean;
  asOf?: string;
}>();

const router = useRouter();

function formatDate(d: string | null): string {
  if (!d) return "—";
  // YYYY-MM-DD 形或 ISO 串
  return d.length >= 10 ? d.slice(0, 10) : d;
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
function goProject(pid: string): void {
  void router.push({ name: "project-detail", params: { id: pid } });
}
</script>
