/**
 * IBusinessModuleRepository —— 业务模块仓储接口
 *
 * 阶段 7.0。统一接口支持所有 kind；通过 `listByKind` / `getByProjectAndKind` 等方法过滤。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { BusinessModuleItemSnapshot } from "./business-module-item.ts";
import type { BusinessModuleKind } from "./business-module.ts";

/** 阶段 7.4g：跨项目聚合（仪表盘用） —— 在原 snapshot 上补 project 关联信息 */
export interface BusinessModuleItemAcrossProjectsSnapshot
  extends BusinessModuleItemSnapshot {
  /** 项目名称（denormalized） */
  projectName: string;
  /** 客户名称（denormalized） */
  clientName: string;
  /** payloadJson.planDate（活动计划日期） —— 非法 JSON 时为 null */
  planDate: string | null;
  /** payloadJson.clientContactName（客户主负责人） —— 非法 JSON 时为 null */
  clientContactName: string | null;
}

export interface ListByKindAcrossProjectsOptions {
  /** planDate 下界（YYYY-MM-DD） —— 跨项目按 planDate 过滤时使用 */
  fromDate?: string;
  /** planDate 上界（YYYY-MM-DD） */
  toDate?: string;
  limit?: number;
  sortByPlanDate?: "asc" | "desc";
  status?: "pending" | "adopted" | "unadopted";
}

export interface IBusinessModuleRepository {
  /** 新建或更新 —— 基于 id 唯一性 */
  save(item: BusinessModuleItemSnapshot): Promise<void>;

  /** 按 id 查（不存在返回 null） */
  findById(id: string): Promise<BusinessModuleItemSnapshot | null>;

  /** 按 project + kind 列表（按 updatedAt desc） */
  listByProjectAndKind(
    projectId: ProjectId,
    kind: BusinessModuleKind,
    opts?: { status?: "pending" | "adopted" | "unadopted" },
  ): Promise<BusinessModuleItemSnapshot[]>;

  /** 删除 —— 不存在不报错 */
  delete(id: string): Promise<void>;

  /** 统计某 project+kind 下 adopted 数量（用于 AI 上下文"是否已有内容"判定） */
  countAdoptedByProjectAndKind(
    projectId: ProjectId,
    kind: BusinessModuleKind,
  ): Promise<number>;

  /** 阶段 7.4g：跨项目列表 —— 仪表盘"待推进活动 TOP5"使用 */
  listByKindAcrossProjects(
    kind: BusinessModuleKind,
    opts: ListByKindAcrossProjectsOptions,
  ): Promise<BusinessModuleItemAcrossProjectsSnapshot[]>;
}
