/**
 * BudgetSettings —— 成本计算设置类型
 *
 * 阶段 7.4b。需求文档第 9 节「功能分析页面 / 14. 成本计算设置画面」：
 *   - 10 个参数；每项目一份（singleton）
 *   - 默认值来自文档字面
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const BUDGET_SETTINGS_KIND: BusinessModuleKind = "budget_settings";

export interface BudgetSettingsPayload {
  /** 完成 1CP 需要时间（小时） */
  hoursPerCP: number;
  /** 每天平均投入时间（小时） */
  hoursPerDay: number;
  /** 单价（元/人日） */
  unitPrice: number;
  /** 需求分析占比 */
  reqAnalysisRatio: number;
  /** 基本设计占比 */
  basicDesignRatio: number;
  /** 测试占比 */
  testRatio: number;
  /** 管理占比 */
  managementRatio: number;
  /** Buffer 占比 */
  bufferRatio: number;
  /** 部署工时（人日） */
  deployDays: number;
  /** 实施培训工时（人日） */
  trainingDays: number;
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettingsPayload = {
  hoursPerCP: 4,
  hoursPerDay: 6,
  unitPrice: 2000,
  reqAnalysisRatio: 0.30,
  basicDesignRatio: 0.30,
  testRatio: 0.30,
  managementRatio: 0.20,
  bufferRatio: 0.10,
  deployDays: 3,
  trainingDays: 5,
};

export function makeBudgetSettingsPayload(
  seed: Partial<BudgetSettingsPayload> = {},
): BudgetSettingsPayload {
  return { ...DEFAULT_BUDGET_SETTINGS, ...seed };
}

export function parseBudgetSettingsPayload(json: string): BudgetSettingsPayload {
  try {
    const obj = JSON.parse(json) as Partial<BudgetSettingsPayload>;
    // 过滤非数字字段 + 校验
    const cleaned: Partial<BudgetSettingsPayload> = {};
    for (const k of Object.keys(DEFAULT_BUDGET_SETTINGS) as (keyof BudgetSettingsPayload)[]) {
      const v = obj[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        cleaned[k] = v;
      }
    }
    return makeBudgetSettingsPayload(cleaned);
  } catch {
    return makeBudgetSettingsPayload();
  }
}

/** 校验：5 个 ratio ∈ [0,1]；其他数字 ≥ 0；hoursPerDay > 0 */
export function validateBudgetSettings(s: BudgetSettingsPayload): { ok: true } | { ok: false; reason: string } {
  if (s.hoursPerCP < 0) return { ok: false, reason: "hoursPerCP 必须 ≥ 0" };
  if (s.hoursPerDay <= 0) return { ok: false, reason: "hoursPerDay 必须 > 0" };
  if (s.unitPrice < 0) return { ok: false, reason: "unitPrice 必须 ≥ 0" };
  for (const [k, v] of [
    ["reqAnalysisRatio", s.reqAnalysisRatio],
    ["basicDesignRatio", s.basicDesignRatio],
    ["testRatio", s.testRatio],
    ["managementRatio", s.managementRatio],
    ["bufferRatio", s.bufferRatio],
  ] as const) {
    if (v < 0 || v > 1) return { ok: false, reason: `${k} 必须在 [0,1]` };
  }
  if (s.deployDays < 0) return { ok: false, reason: "deployDays 必须 ≥ 0" };
  if (s.trainingDays < 0) return { ok: false, reason: "trainingDays 必须 ≥ 0" };
  return { ok: true };
}
