/**
 * Dashboard API client —— 调后端 /api/dashboard/*
 *
 * 阶段 7.4g：仪表盘聚合数据。
 *   - summary: 三张 KPI（本月新增 / 年中标 / 年未中标 / 历史总）
 *   - monthly: 月度统计 12 行（created / won / lost）
 *   - upcoming-activities: 待推进活动 TOP（status=pending + planDate>=today）
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";

export interface DashboardSummary {
  monthNew: number;
  yearWon: number;
  yearLost: number;
  total: number;
  asOf: string;
}

export interface MonthlyStat {
  month: number;       // 1..12
  created: number;
  won: number;
  lost: number;
}

export interface UpcomingActivity {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string;
  planDate: string | null;
  title: string;
  clientContactName: string | null;
}

export const dashboardApi = {
  async getSummary(): Promise<DashboardSummary> {
    return await http.get<DashboardSummary>(Endpoints.dashboardSummary);
  },
  async getMonthly(year?: number): Promise<MonthlyStat[]> {
    const query = year !== undefined ? { year: String(year) } : {};
    return await http.get<MonthlyStat[]>(Endpoints.dashboardMonthly, { query });
  },
  async getUpcomingActivities(limit = 5): Promise<UpcomingActivity[]> {
    return await http.get<UpcomingActivity[]>(
      Endpoints.dashboardUpcomingActivities,
      { query: { limit: String(limit) } },
    );
  },
};
