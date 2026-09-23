/**
 * FunctionListItem —— 功能清单类型
 *
 * 阶段 7.4b。需求文档第 9 节「功能分析页面」：
 *   - 功能字段：id, 分类, 模块, 功能名, 功能详细, 备注, CP值, 工时(派生), 金额(派生), 是否项目范围内开关
 *   - CP 值（Fibonacci）：1, 2, 3, 5, 8, 13, 21（默认空 = 0 表示未设，不计入合计）
 *   - inScope=true 时计入顶部汇总与预算；false 时排除并自动设 status=unadopted 以排除 AI 上下文
 *
 * 复用 BusinessModuleItem；payloadJson 存结构化字段；content 留空（详细描述用 detail 字段）。
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const FUNCTION_LIST_KIND: BusinessModuleKind = "function_list";

export const CP_VALUES = [1, 2, 3, 5, 8, 13, 21] as const;
export type CPValue = typeof CP_VALUES[number];

export interface FunctionListPayload {
  /** 分类（业务大类） */
  category: string;
  /** 模块（子分类） */
  module: string;
  /** 功能名 */
  name: string;
  /** 功能详细 */
  detail: string;
  /** 备注 */
  remarks: string;
  /** CP 值（Fibonacci）；0 = 未设，不计入合计 */
  cp: CPValue | 0;
  /** 是否项目范围内 */
  inScope: boolean;
}

export function isValidCP(n: number): n is CPValue {
  return (CP_VALUES as readonly number[]).includes(n);
}

export function makeFunctionListPayload(seed: Partial<FunctionListPayload> = {}): FunctionListPayload {
  return {
    category: seed.category ?? "",
    module: seed.module ?? "",
    name: seed.name ?? "",
    detail: seed.detail ?? "",
    remarks: seed.remarks ?? "",
    cp: seed.cp ?? 0,
    inScope: seed.inScope ?? true,
  };
}

export function parseFunctionListPayload(json: string): FunctionListPayload {
  try {
    const obj = JSON.parse(json) as Partial<FunctionListPayload>;
    return makeFunctionListPayload(obj);
  } catch {
    return makeFunctionListPayload();
  }
}

/** 过滤 + 帮助：仅 in-scope 且 CP 已设的功能 */
export function inScopeFunctions(
  fns: readonly FunctionListPayload[],
): FunctionListPayload[] {
  return fns.filter((f) => f.inScope && f.cp !== 0);
}

/** 自动拼接 title（BusinessModuleItem.title 字段必填且用于列表显示） */
export function makeFunctionTitle(payload: FunctionListPayload): string {
  const parts = [payload.category, payload.module, payload.name].filter((p) => p.trim() !== "");
  return parts.length > 0 ? parts.join(" / ") : "未命名功能";
}
