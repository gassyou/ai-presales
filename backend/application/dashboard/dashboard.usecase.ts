/**
 * DashboardUseCase —— 仪表盘聚合用例
 *
 * 阶段 7.4g：仪表盘四块内容
 *   - 三张 KPI 卡：本月新增 / 年度中标 / 历史总案件
 *   - 月度表：12 行 ×（新增 / 中标 / 未中标）
 *   - 待推进活动 TOP5：status=pending + planDate >= today，按 planDate ASC
 *
 * 设计：
 *   - 纯聚合读，不引入新表
 *   - 用 clock 注入"今天"基准（便于测试）
 *   - 用 yearProvider 注入"当前年份"（便于测试）
 *   - 调用方（route 层）只看到 DashboardSummary / MonthlyStat / UpcomingActivity 三种 DTO
 */

import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import type { IProjectRepository } from "@backend/domain/project/project.repository.ts";
import type {
  BusinessModuleItemAcrossProjectsSnapshot,
  IBusinessModuleRepository,
} from "@backend/domain/business-module/business-module.repository.ts";

export interface DashboardSummary {
  /** 本月新增案件数（按 created_at 落在 [本月1号, 下月1号)） */
  monthNew: number;
  /** 本年度中标数（按 won_date；旧数据 fallback 到 updated_at 年） */
  yearWon: number;
  /** 本年度未中标数（按 lost_date；旧数据 fallback 到 updated_at 年） */
  yearLost: number;
  /** 历史总案件数 */
  total: number;
  /** 数据截止时间（ISO string）—— 前端用于显示"截至 X 更新" */
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
  /** 计划日期（YYYY-MM-DD 或 ISO） */
  planDate: string | null;
  /** 主题（活动标题） */
  title: string;
  /** 客户主负责人（payloadJson.clientContactName） */
  clientContactName: string | null;
}

export interface DashboardUseCaseDeps {
  projectRepo: IProjectRepository;
  businessModuleRepo: IBusinessModuleRepository;
  clock?: Clock;
  yearProvider?: () => number;
  /** 测试用：覆盖"今天"字符串 —— 默认取 clock.now() 的 YYYY-MM-DD */
  todayProvider?: () => string;
}

export class DashboardUseCase {
  private readonly projectRepo: IProjectRepository;
  private readonly businessModuleRepo: IBusinessModuleRepository;
  private readonly clock: Clock;
  private readonly yearProvider: () => number;
  private readonly todayProvider: () => string;

  constructor(deps: DashboardUseCaseDeps) {
    this.projectRepo = deps.projectRepo;
    this.businessModuleRepo = deps.businessModuleRepo;
    this.clock = deps.clock ?? new SystemClock();
    this.yearProvider = deps.yearProvider ?? (() => this.clock.now().getFullYear());
    this.todayProvider = deps.todayProvider ?? (() => toDateString(this.clock.now()));
  }

  /** 三张 KPI 卡 */
  async getSummary(): Promise<DashboardSummary> {
    const now = this.clock.now();
    const year = this.yearProvider();
    const monthStart = new Date(year, now.getMonth(), 1, 0, 0, 0, 0);
    const nextMonthStart = new Date(year, now.getMonth() + 1, 1, 0, 0, 0, 0);
    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0);

    const [monthNew, yearWon, yearLost, total] = await Promise.all([
      this.projectRepo.countCreatedBetween(monthStart, nextMonthStart),
      this.projectRepo.countByStatusInRange("中标", yearStart, yearEnd),
      this.projectRepo.countByStatusInRange("未中标", yearStart, yearEnd),
      this.projectRepo.countAll(),
    ]);
    return {
      monthNew,
      yearWon,
      yearLost,
      total,
      asOf: now.toISOString(),
    };
  }

  /** 月度统计 —— 默认当前年；可传入任意年份 */
  async getMonthlyStats(year?: number): Promise<MonthlyStat[]> {
    const y = year ?? this.yearProvider();
    const rows = await this.projectRepo.monthlyStats(y);
    return rows.map((r) => ({
      month: r.month,
      created: r.created,
      won: r.won,
      lost: r.lost,
    }));
  }

  /** 待推进活动 TOP —— 默认 5；status=pending + planDate >= today + 排序 ASC */
  async getUpcomingActivities(limit = 5): Promise<UpcomingActivity[]> {
    const today = this.todayProvider();
    const rows: BusinessModuleItemAcrossProjectsSnapshot[] = await this
      .businessModuleRepo.listByKindAcrossProjects("activity", {
        fromDate: today,
        status: "pending",
        limit,
        sortByPlanDate: "asc",
      });
    return rows
      .filter((r) => r.planDate !== null)
      .map((r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: r.projectName,
        clientName: r.clientName,
        planDate: r.planDate,
        title: r.title,
        clientContactName: r.clientContactName,
      }));
  }
}

/** Date → YYYY-MM-DD（本地时区） */
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
