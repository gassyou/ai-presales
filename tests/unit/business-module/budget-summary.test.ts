/**
 * BudgetSummary 纯函数单元测试
 *
 * 阶段 7.4b。覆盖：
 *   - computeFunctionEffortHours（CP=0 / inScope=false / 默认值）
 *   - computeFunctionAmount / ManDays 转换
 *   - computeTopSummary（含 out-of-scope 排除 + 顶部 6 数字）
 *   - computeModuleBudget（按 category/module 分组 + footer）
 *   - computePhaseBudget（9 行固定顺序 + Buffer 在 实施培训 后）
 *   - computeBudgetSummary（三合一）
 */

import { assert, assertEquals } from "@std/assert";
import {
  computeFunctionAmount,
  computeFunctionEffortHours,
  computeFunctionManDays,
  computeBudgetSummary,
  computeModuleBudget,
  computePhaseBudget,
  computeTopSummary,
} from "@backend/domain/business-module/budget-summary.ts";
import {
  DEFAULT_BUDGET_SETTINGS,
  makeBudgetSettingsPayload,
} from "@backend/domain/business-module/budget-settings.ts";
import {
  makeFunctionListPayload,
  type FunctionListPayload,
} from "@backend/domain/business-module/function-list.ts";

const S = DEFAULT_BUDGET_SETTINGS;

Deno.test("computeFunctionEffortHours — CP=5 默认 → 42 hours", () => {
  const fn = makeFunctionListPayload({ cp: 5, inScope: true });
  assertEquals(computeFunctionEffortHours(fn, S), 5 * 4 * 2.10);
  // = 5 × 4 × (1 + 0.3 + 0.3 + 0.3 + 0.2) = 5 × 4 × 2.1 = 42
});

Deno.test("computeFunctionEffortHours — CP=0 → 0", () => {
  const fn = makeFunctionListPayload({ cp: 0, inScope: true });
  assertEquals(computeFunctionEffortHours(fn, S), 0);
});

Deno.test("computeFunctionEffortHours — inScope=false → 0", () => {
  const fn = makeFunctionListPayload({ cp: 5, inScope: false });
  assertEquals(computeFunctionEffortHours(fn, S), 0);
});

Deno.test("computeFunctionAmount — CP=5 默认 → 10500 元", () => {
  // 42 hours / 8 × 2000 = 5.25 × 2000 = 10500
  assertEquals(computeFunctionAmount(42, S), 10500);
});

Deno.test("computeFunctionManDays — 42h → 5.25 人日", () => {
  assertEquals(computeFunctionManDays(42), 5.25);
});

Deno.test("computeTopSummary — 空 → 全 0", () => {
  const top = computeTopSummary([], S);
  assertEquals(top.totalCP, 0);
  assertEquals(top.totalEffortHours, 0);
  assertEquals(top.functionTotalAmount, 0);
  assertEquals(top.deployTrainingAmount, (3 + 5) * 2000);
  assertEquals(top.totalAmountExclTax, (3 + 5) * 2000);
  // totalPeriodDays = (0 + 3 + 5) / 6 = 8/6
  assertEquals(Math.round(top.totalPeriodDays * 1000), Math.round((8 / 6) * 1000));
});

Deno.test("computeTopSummary — 2 个 in-scope 功能", () => {
  const fns = [
    makeFunctionListPayload({ name: "A", cp: 5, inScope: true }),
    makeFunctionListPayload({ name: "B", cp: 8, inScope: true }),
  ];
  const top = computeTopSummary(fns, S);
  assertEquals(top.totalCP, 13);
  // A=42h, B=67.2h
  assertEquals(Math.round(top.totalEffortHours * 100), 10920);
  // (42 + 67.2)/8 × 2000 = 13.65 × 2000 = 27300
  assertEquals(Math.round(top.functionTotalAmount * 100), 2730000);
});

Deno.test("computeTopSummary — out-of-scope 排除", () => {
  const fns = [
    makeFunctionListPayload({ name: "A", cp: 5, inScope: true }),
    makeFunctionListPayload({ name: "B", cp: 8, inScope: false }),
  ];
  const top = computeTopSummary(fns, S);
  assertEquals(top.totalCP, 5);
  assertEquals(Math.round(top.totalEffortHours * 100), 4200);
});

Deno.test("computeTopSummary — deployTraining 公式", () => {
  // 验证：(deployDays + trainingDays + totalManDays × bufferRatio) × unitPrice
  // totalManDays=10, deploy=3, training=5, buffer=0.1, price=2000
  // = (3 + 5 + 1) × 2000 = 18000
  const fns = [
    makeFunctionListPayload({ name: "A", cp: 8, inScope: true }),  // 8×4×2.10 = 67.2h = 8.4 man-days
  ];
  const top = computeTopSummary(fns, S);
  // 8.4 man-days → buffer portion = 0.84
  // (3 + 5 + 0.84) × 2000 = 17,680
  assertEquals(Math.round(top.deployTrainingAmount), 17680);
});

Deno.test("computeModuleBudget — 按 category/module 分组合并", () => {
  const fns: FunctionListPayload[] = [
    makeFunctionListPayload({ category: "A", module: "M1", cp: 5, inScope: true }),
    makeFunctionListPayload({ category: "A", module: "M1", cp: 3, inScope: true }),
    makeFunctionListPayload({ category: "A", module: "M2", cp: 8, inScope: true }),
    makeFunctionListPayload({ category: "B", module: "M3", cp: 5, inScope: false }),  // 不计
  ];
  const m = computeModuleBudget(fns, S);
  assertEquals(m.rows.length, 2, "应合并 A/M1，只剩 2 个分组");
  const am1 = m.rows.find((r) => r.category === "A" && r.module === "M1");
  assert(am1, "A/M1 应存在");
  // 5.25 + 3.15 = 8.4 man-days
  assertEquals(Math.round(am1.manDays * 100), 840);
  // amount = 8.4 × 2000 = 16800
  assertEquals(Math.round(am1.amount), 16800);
});

Deno.test("computeModuleBudget — footer 4 行", () => {
  const m = computeModuleBudget([], S);
  assertEquals(m.deploy.module, "部署");
  assertEquals(m.deploy.manDays, 3);
  assertEquals(m.training.module, "实施培训");
  assertEquals(m.training.manDays, 5);
  assertEquals(m.buffer.module, "Buffer");
  assertEquals(m.buffer.manDays, 0);
  assertEquals(m.total.module, "合计");
  assertEquals(m.total.manDays, 8);
  assertEquals(Math.round(m.total.amount), 16000);
});

Deno.test("computePhaseBudget — 9 行固定顺序", () => {
  const fns = [
    makeFunctionListPayload({ name: "A", cp: 21, inScope: true }),  // dev = 21 × 4 / 8 = 10.5
  ];
  const p = computePhaseBudget(fns, S);
  assertEquals(p.length, 9);
  assertEquals(p[0]!.phase, "需求分析");
  assertEquals(p[1]!.phase, "基本设计");
  assertEquals(p[2]!.phase, "开发与单体测试");
  assertEquals(p[3]!.phase, "测试");
  assertEquals(p[4]!.phase, "项目管理");
  assertEquals(p[5]!.phase, "部署");
  assertEquals(p[6]!.phase, "实施培训");
  assertEquals(p[7]!.phase, "Buffer");
  assertEquals(p[8]!.phase, "合计");
  // dev = 10.5
  assertEquals(p[2]!.manDays, 10.5);
  // req = 10.5 × 0.30 = 3.15
  assertEquals(p[0]!.manDays, 3.15);
  // 合计 = 3.15 + 3.15 + 10.5 + 3.15 + 2.1 + 3 + 5 + 1.05 = 31.10
  assertEquals(Math.round(p[8]!.manDays * 100), 3110);
});

Deno.test("computeBudgetSummary — 三合一 + 集成", () => {
  const fns = [
    makeFunctionListPayload({ category: "A", module: "M1", name: "X", cp: 5, inScope: true }),
  ];
  const s = makeBudgetSettingsPayload({ unitPrice: 1000 });
  const sum = computeBudgetSummary(fns, s);
  assertEquals(sum.top.totalCP, 5);
  assertEquals(sum.byModule.rows.length, 1);
  assertEquals(sum.byPhase.length, 9);
  assertEquals(sum.byPhase[8]!.phase, "合计");
});

Deno.test("makeBudgetSettingsPayload — 默认 + 部分覆盖", () => {
  const s = makeBudgetSettingsPayload({ unitPrice: 3000 });
  assertEquals(s.unitPrice, 3000);
  assertEquals(s.hoursPerCP, 4);
});
