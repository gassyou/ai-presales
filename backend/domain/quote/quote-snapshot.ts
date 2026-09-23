/**
 * QuoteSnapshot —— 报价单派生快照
 *
 * 阶段 7.4f。需求文档第 89-92 行：
 *   "基于项目功能分析和硬件设备成本分析中的数据内容生成报价单"
 *
 * 设计要点：
 *   - 派生结果（每次 getQuote 实时算；quote_runs 仅缓存生成时点的快照）
 *   - 软件金额 = budget_summary.top.functionTotalAmount（来自 function_list + budget_settings）
 *   - 部署培训金额 = budget_summary.top.deployTrainingAmount
 *   - 硬件金额 = hardware.items 合计
 *   - grandTotalExclTax = 软件 + 部署培训 + 硬件（不含税；税率/抬头/有效期在 Excel 模板中体现）
 */

import type { FunctionListPayload } from "../business-module/function-list.ts";
import type { BudgetSettingsPayload } from "../business-module/budget-settings.ts";
import type { HardwareItemPayload, HardwareItemsPayload, HardwareGroup } from "../business-module/hardware-items.ts";
import { computeTopSummary, type TopSummary } from "../business-module/budget-summary.ts";
import { groupByCategory, totalSubtotal } from "../business-module/hardware-items.ts";

export interface QuoteSnapshot {
  top: TopSummary; // 与 budget_summary.top 同形
  hardware: {
    items: HardwareItemPayload[];
    subtotal: number;
    groupedByCategory: HardwareGroup[];
  };
  software: {
    subtotal: number; // = top.functionTotalAmount
  };
  deployTraining: {
    subtotal: number; // = top.deployTrainingAmount
  };
  /** 不含税总计：软件 + 部署培训 + 硬件 */
  grandTotalExclTax: number;
}

export function computeQuoteSnapshot(args: {
  functions: readonly FunctionListPayload[];
  settings: BudgetSettingsPayload;
  hardware: HardwareItemsPayload;
}): QuoteSnapshot {
  const top = computeTopSummary(args.functions, args.settings);
  const hardwareSubtotal = totalSubtotal(args.hardware);
  return {
    top,
    hardware: {
      items: args.hardware.items,
      subtotal: hardwareSubtotal,
      groupedByCategory: groupByCategory(args.hardware),
    },
    software: { subtotal: top.functionTotalAmount },
    deployTraining: { subtotal: top.deployTrainingAmount },
    grandTotalExclTax: top.functionTotalAmount + top.deployTrainingAmount + hardwareSubtotal,
  };
}