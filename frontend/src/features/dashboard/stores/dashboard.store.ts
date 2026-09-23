/**
 * Dashboard Store —— 仪表盘数据状态（阶段 7.4g）
 *
 * 三个 slice：
 *   - summary：本月新增 / 年中标 / 年未中标 / 历史总
 *   - monthly：12 行 ×（created / won / lost）
 *   - upcoming：待推进活动 TOP（默认 5 条）
 *
 * loadAll() 并行拉取三个端点；单独加载某个 slice 通过 changeYear / changeLimit。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  dashboardApi,
  type DashboardSummary,
  type MonthlyStat,
  type UpcomingActivity,
} from "../api/dashboard.api.ts";

export const useDashboardStore = defineStore("dashboard", () => {
  const summary = ref<DashboardSummary | null>(null);
  const monthly = ref<MonthlyStat[]>([]);
  const upcoming = ref<UpcomingActivity[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const year = ref<number | null>(null);
  const upcomingLimit = ref(5);

  async function loadSummary(): Promise<void> {
    summary.value = await dashboardApi.getSummary();
  }

  async function loadMonthly(targetYear?: number): Promise<void> {
    if (targetYear !== undefined) year.value = targetYear;
    monthly.value = await dashboardApi.getMonthly(year.value ?? undefined);
  }

  async function loadUpcoming(limit?: number): Promise<void> {
    if (limit !== undefined) upcomingLimit.value = limit;
    upcoming.value = await dashboardApi.getUpcomingActivities(upcomingLimit.value);
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await Promise.all([loadSummary(), loadMonthly(), loadUpcoming()]);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await loadAll();
  }

  async function changeYear(targetYear: number): Promise<void> {
    await loadMonthly(targetYear);
  }

  return {
    summary,
    monthly,
    upcoming,
    loading,
    error,
    year,
    upcomingLimit,
    loadAll,
    refresh,
    changeYear,
  };
});
