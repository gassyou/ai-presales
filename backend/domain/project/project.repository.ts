/**
 * IProjectRepository —— 仓储接口（领域侧）
 *
 * 设计：
 *   - save(p) 不存在则 INSERT，存在则 UPDATE（upsert）
 *   - findById 返回聚合根（rehydrate），找不到返回 DomainError
 *   - list 按 updatedAt desc + 分页
 *   - delete 仅真删除；归档走业务状态
 *
 * 跨聚合事务由 UnitOfWork 处理，仓储内部事务封装"保存单个聚合根"。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import type { Project, ProjectSnapshot } from "./project.ts";
import type { ProjectStatusValue } from "./project-status.ts";

export interface ProjectListFilter {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface ProjectListResult {
  items: readonly ProjectSnapshot[];
  total: number;
  limit: number;
  offset: number;
}

/** 阶段 7.4g：仪表盘月度统计行 */
export interface MonthlyStatRow {
  month: number;     // 1..12
  created: number;
  won: number;
  lost: number;
}

export interface IProjectRepository {
  save(project: Project): Promise<DomainResult<void>>;
  findById(id: ProjectId): Promise<DomainResult<Project>>;
  /** 测试 / 某些查询直接拿快照 —— 跳过 rehydrate 节省时间 */
  findSnapshotById(id: ProjectId): Promise<ProjectSnapshot | null>;
  list(filter: ProjectListFilter): Promise<ProjectListResult>;
  delete(id: ProjectId): Promise<DomainResult<void>>;
  /** 生成下一个业务编号；留给仓储实现决定是事务安全递增还是查表 */
  nextProjectCode(year: number): Promise<string>;
  /** 按 code / name 模糊匹配 mention token —— 用于 @项目名 解析 */
  findByMentionToken(token: string): Promise<ProjectSnapshot | null>;
  // ---------- 阶段 7.4g：仪表盘聚合 ----------
  /** 全部项目数 */
  countAll(): Promise<number>;
  /** [from, to) 区间内 created_at 的项目数 */
  countCreatedBetween(from: Date, to: Date): Promise<number>;
  /** [from, to) 区间内 status + status="中标"/"未中标" 时按 won_date/lost_date 计数；
   *  对"中标"/"未中标"且 *date 为 NULL 时 fallback 到 updated_at 年（兼容旧数据） */
  countByStatusInRange(
    status: ProjectStatusValue,
    from: Date,
    to: Date,
  ): Promise<number>;
  /** 给定年份的月度统计 —— 总是返回 12 行（空年全 0） */
  monthlyStats(year: number): Promise<MonthlyStatRow[]>;
}