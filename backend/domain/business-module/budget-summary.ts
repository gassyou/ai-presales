/**
 * BudgetSummary —— 预算汇总类型 + 纯计算函数
 *
 * 阶段 7.4b。需求文档第 9 节「功能分析页面 / 15. 预算结果」：
 *   - 顶部 6 汇总数字
 *   - 按模块展示预算表（行：分类 / 模块 / 工时数(人日) / 金额 / 期间(人日) / 期间(人月)；footer：部署/实施培训/Buffer/合计）
 *   - 按开发阶段展示预算表（9 行固定顺序）
 *
 * **重要：per-function 工时合计 ≠ phase 表合计（by doc design）**
 *   - per-function 总和 = totalCP × hoursPerCP × (1 + req+basic+test+mgmt) / 8 = totalCP × hoursPerCP × 2.10 / 8（默认）
 *   - phase 表合计 = dev × (1 + 4 ratios + bufferRatio) + deploy + training = totalCP × hoursPerCP × 2.20 / 8 + 8
 *   - phase 表比 per-function 总和多 dev × bufferRatio（Buffer 仅项目级，不计入功能级）
 *
 * 调用方需传入已过滤的函数列表（in-scope + CP 已设）；本模块不再二次过滤。
 */

import type { BudgetSettingsPayload } from "./budget-settings.ts";
import type { FunctionListPayload } from "./function-list.ts";
import { inScopeFunctions } from "./function-list.ts";

// ============================================================
// Types
// ============================================================

export interface TopSummary {
  /** 所有 in-scope 功能的 CP 总和 */
  totalCP: number;
  /** 所有 in-scope 功能工时合计（小时） */
  totalEffortHours: number;
  /** 仅功能金额（不含部署/培训/Buffer） */
  functionTotalAmount: number;
  /**
   * 实施・部署培训金额 =
   * (deployDays + trainingDays + totalManDays × bufferRatio) × unitPrice
   */
  deployTrainingAmount: number;
  /** 项目总金额（不含税）= functionTotalAmount + deployTrainingAmount */
  totalAmountExclTax: number;
  /**
   * 项目总工期（天）= (totalManDays + deployDays + trainingDays) / hoursPerDay
   * 注：文档 label 写「人日」，但公式 `/hoursPerDay` 实际得「天」，UI 标签按公式结果展示。
   */
  totalPeriodDays: number;
}

export interface ModuleBudgetRow {
  category: string;
  module: string;
  manDays: number;
  amount: number;
  /** 期间（人日）= manDays / hoursPerDay */
  periodDays: number;
  /** 期间（人月）= manDays / 20 / hoursPerDay */
  periodMonths: number;
}

export interface ModuleBudgetTable {
  rows: ModuleBudgetRow[];
  deploy: ModuleBudgetRow;
  training: ModuleBudgetRow;
  buffer: ModuleBudgetRow;
  total: ModuleBudgetRow;
}

export type PhaseName =
  | "需求分析"
  | "基本设计"
  | "开发与单体测试"
  | "测试"
  | "项目管理"
  | "部署"
  | "实施培训"
  | "Buffer"
  | "合计";

export interface PhaseBudgetRow {
  phase: PhaseName;
  manDays: number;
  amount: number;
  /** 期间（人日）= manDays / hoursPerDay */
  periodDays: number;
  /** 期间（人月）= manDays / 20 / hoursPerDay */
  periodMonths: number;
}

export interface BudgetSummary {
  top: TopSummary;
  byModule: ModuleBudgetTable;
  byPhase: PhaseBudgetRow[];
}

// ============================================================
// Per-function 计算
// ============================================================

/**
 * 单个功能的工时（小时）
 *
 * 公式：CP × hoursPerCP × (1 + 需求分析% + 基本设计% + 测试% + 管理%)
 * 默认值下：CP × 4 × 2.10 = 8.4 × CP hours
 *
 * 规则：CP=0 或 inScope=false → 返回 0（视为「无工作量」）
 */
export function computeFunctionEffortHours(
  fn: FunctionListPayload,
  s: BudgetSettingsPayload,
): number {
  if (fn.cp === 0 || !fn.inScope) return 0;
  const mult = 1 + s.reqAnalysisRatio + s.basicDesignRatio + s.testRatio + s.managementRatio;
  return fn.cp * s.hoursPerCP * mult;
}

/** 工时 → 人日 */
export function computeFunctionManDays(effortHours: number): number {
  return effortHours / 8;
}

/** 人日 → 金额（元） */
export function computeAmountFromManDays(manDays: number, s: BudgetSettingsPayload): number {
  return manDays * s.unitPrice;
}

/** 工时 → 金额（= effortHours/8 × unitPrice） */
export function computeFunctionAmount(effortHours: number, s: BudgetSettingsPayload): number {
  return computeAmountFromManDays(computeFunctionManDays(effortHours), s);
}

/** 期间（人日）= manDays / hoursPerDay */
export function computePeriodDays(manDays: number, s: BudgetSettingsPayload): number {
  if (s.hoursPerDay <= 0) return 0;
  return manDays / s.hoursPerDay;
}

/** 期间（人月）= manDays / 20 / hoursPerDay（每月 20 工作日） */
export function computePeriodMonths(manDays: number, s: BudgetSettingsPayload): number {
  if (s.hoursPerDay <= 0) return 0;
  return manDays / 20 / s.hoursPerDay;
}

// ============================================================
// Top Summary
// ============================================================

/**
 * 顶部 6 汇总数字
 *
 * 输入：调用方需传入已过滤的 in-scope 函数列表（含 CP=0 的也传；本函数会自动排除 CP=0）
 */
export function computeTopSummary(
  fns: readonly FunctionListPayload[],
  s: BudgetSettingsPayload,
): TopSummary {
  const valid = inScopeFunctions(fns);
  let totalCP = 0;
  let totalEffortHours = 0;
  let functionTotalAmount = 0;
  let totalManDays = 0;

  for (const fn of valid) {
    totalCP += fn.cp;
    const hours = computeFunctionEffortHours(fn, s);
    totalEffortHours += hours;
    const manDays = computeFunctionManDays(hours);
    totalManDays += manDays;
    functionTotalAmount += computeAmountFromManDays(manDays, s);
  }

  const deployTrainingAmount = (s.deployDays + s.trainingDays + totalManDays * s.bufferRatio) *
    s.unitPrice;
  const totalAmountExclTax = functionTotalAmount + deployTrainingAmount;
  const totalPeriodDays = computePeriodDays(totalManDays + s.deployDays + s.trainingDays, s);

  return {
    totalCP,
    totalEffortHours,
    functionTotalAmount,
    deployTrainingAmount,
    totalAmountExclTax,
    totalPeriodDays,
  };
}

// ============================================================
// Module Budget
// ============================================================

/**
 * 按模块展示预算
 *
 * 规则：
 *   - 按 {category, module} 分组
 *   - 同一 {category, module} 下的所有 in-scope 函数累加 manDays
 *   - footer 行：deploy / training / buffer / total（固定 4 行）
 */
export function computeModuleBudget(
  fns: readonly FunctionListPayload[],
  s: BudgetSettingsPayload,
): ModuleBudgetTable {
  const valid = inScopeFunctions(fns);

  // 按 category|module 分组累加 manDays
  const groups = new Map<string, { category: string; module: string; manDays: number }>();
  for (const fn of valid) {
    const key = `${fn.category}\u0000${fn.module}`;
    let g = groups.get(key);
    if (!g) {
      g = { category: fn.category || "未分类", module: fn.module || "未分组", manDays: 0 };
      groups.set(key, g);
    }
    g.manDays += computeFunctionManDays(computeFunctionEffortHours(fn, s));
  }

  const rows: ModuleBudgetRow[] = [];
  let totalManDays = 0;
  // 排序：按 category 然后 module（中文 localeCompare）
  const sorted = [...groups.values()].sort((a, b) => {
    const c = a.category.localeCompare(b.category, "zh-Hans-CN");
    return c !== 0 ? c : a.module.localeCompare(b.module, "zh-Hans-CN");
  });
  for (const g of sorted) {
    rows.push(toModuleBudgetRow(g.category, g.module, g.manDays, s));
    totalManDays += g.manDays;
  }

  const deployManDays = s.deployDays;
  const trainingManDays = s.trainingDays;
  const bufferManDays = totalManDays * s.bufferRatio;

  const deploy = toModuleBudgetRow("—", "部署", deployManDays, s);
  const training = toModuleBudgetRow("—", "实施培训", trainingManDays, s);
  const buffer = toModuleBudgetRow("—", "Buffer", bufferManDays, s);
  const total = toModuleBudgetRow(
    "—",
    "合计",
    totalManDays + deployManDays + trainingManDays + bufferManDays,
    s,
  );

  return { rows, deploy, training, buffer, total };
}

function toModuleBudgetRow(
  category: string,
  module: string,
  manDays: number,
  s: BudgetSettingsPayload,
): ModuleBudgetRow {
  return {
    category,
    module,
    manDays,
    amount: computeAmountFromManDays(manDays, s),
    periodDays: computePeriodDays(manDays, s),
    periodMonths: computePeriodMonths(manDays, s),
  };
}

// ============================================================
// Phase Budget
// ============================================================

/**
 * 按开发阶段展示预算（9 行固定顺序）
 *
 * 公式（文档 9.15）：
 *   - 开发与单体测试（dev） = totalCP × hoursPerCP / 8
 *   - 需求分析 = dev × reqAnalysisRatio
 *   - 基本设计 = dev × basicDesignRatio
 *   - 测试 = dev × testRatio
 *   - 项目管理 = dev × managementRatio
 *   - 部署 = deployDays
 *   - 实施培训 = trainingDays
 *   - Buffer = dev × bufferRatio
 *   - 合计 = 上 8 行之和
 */
export function computePhaseBudget(
  fns: readonly FunctionListPayload[],
  s: BudgetSettingsPayload,
): PhaseBudgetRow[] {
  const valid = inScopeFunctions(fns);
  const totalCP = valid.reduce((acc, fn) => acc + fn.cp, 0);
  const dev = totalCP * s.hoursPerCP / 8;

  const rows: Array<{ phase: PhaseName; manDays: number }> = [
    { phase: "需求分析", manDays: dev * s.reqAnalysisRatio },
    { phase: "基本设计", manDays: dev * s.basicDesignRatio },
    { phase: "开发与单体测试", manDays: dev },
    { phase: "测试", manDays: dev * s.testRatio },
    { phase: "项目管理", manDays: dev * s.managementRatio },
    { phase: "部署", manDays: s.deployDays },
    { phase: "实施培训", manDays: s.trainingDays },
    { phase: "Buffer", manDays: dev * s.bufferRatio },
  ];
  const sum = rows.reduce((acc, r) => acc + r.manDays, 0);
  rows.push({ phase: "合计", manDays: sum });

  return rows.map((r) => ({
    phase: r.phase,
    manDays: r.manDays,
    amount: computeAmountFromManDays(r.manDays, s),
    periodDays: computePeriodDays(r.manDays, s),
    periodMonths: computePeriodMonths(r.manDays, s),
  }));
}

// ============================================================
// Combined
// ============================================================

export function computeBudgetSummary(
  fns: readonly FunctionListPayload[],
  s: BudgetSettingsPayload,
): BudgetSummary {
  return {
    top: computeTopSummary(fns, s),
    byModule: computeModuleBudget(fns, s),
    byPhase: computePhaseBudget(fns, s),
  };
}
