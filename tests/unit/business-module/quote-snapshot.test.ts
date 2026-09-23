/**
 * quote-snapshot.ts 派生计算测试
 *
 * 阶段 7.4f。
 */

import { assert, assertEquals } from "@std/assert";
import {
  computeQuoteSnapshot,
} from "@backend/domain/quote/quote-snapshot.ts";
import { DEFAULT_BUDGET_SETTINGS } from "@backend/domain/business-module/budget-settings.ts";
import { EMPTY_HARDWARE_ITEMS, makeHardwareItemsPayload } from "@backend/domain/business-module/hardware-items.ts";
import { makeFunctionListPayload } from "@backend/domain/business-module/function-list.ts";

Deno.test("quote-snapshot — 空输入 → 软件 + 硬件 = 0；deployTraining = deployDays × unitPrice", () => {
  // 注：DEFAULT_BUDGET_SETTINGS.deployDays = 3, trainingDays = 5，
  // 故 deployTrainingAmount 在空 inputs 下 = (3+5)*2000 = 16000（不依赖 function list）。
  // 这里只校验 software/hardware/totalCP=0；deployTraining 不归零。
  const snap = computeQuoteSnapshot({
    functions: [],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: EMPTY_HARDWARE_ITEMS,
  });
  assertEquals(snap.top.totalCP, 0);
  assertEquals(snap.software.subtotal, 0);
  assertEquals(snap.hardware.subtotal, 0);
  assertEquals(snap.deployTraining.subtotal, 16000);
  assertEquals(snap.grandTotalExclTax, 16000);
});

Deno.test("quote-snapshot — 加 1 个 CP=5 in-scope 功能 → software.subtotal 增加", () => {
  const fn = makeFunctionListPayload({ category: "A", module: "B", name: "F1", cp: 5, inScope: true });
  const snap = computeQuoteSnapshot({
    functions: [fn],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: EMPTY_HARDWARE_ITEMS,
  });
  assert(snap.software.subtotal > 0);
  assertEquals(snap.top.totalCP, 5);
  assertEquals(snap.hardware.subtotal, 0);
  // grandTotal = software + deployTraining + 0
  assertEquals(snap.grandTotalExclTax, snap.software.subtotal + snap.deployTraining.subtotal);
});

Deno.test("quote-snapshot — 加 1 个硬件 → grandTotalExclTax = software + deployTraining + hardware", () => {
  const fn = makeFunctionListPayload({ category: "A", module: "B", name: "F1", cp: 5, inScope: true });
  const hw = makeHardwareItemsPayload({
    items: [{
      category: "服务器",
      device: "S1",
      spec: "X",
      qty: 2,
      unitPrice: 1000,
      subtotal: 2000,
      remarks: "",
    }],
  });
  const snap = computeQuoteSnapshot({
    functions: [fn],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: hw,
  });
  assertEquals(snap.hardware.subtotal, 2000);
  assertEquals(
    snap.grandTotalExclTax,
    snap.software.subtotal + snap.deployTraining.subtotal + snap.hardware.subtotal,
  );
});

Deno.test("quote-snapshot — out-of-scope 功能不计 software", () => {
  const fn1 = makeFunctionListPayload({ category: "A", module: "B", name: "F1", cp: 5, inScope: false });
  const snap = computeQuoteSnapshot({
    functions: [fn1],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: EMPTY_HARDWARE_ITEMS,
  });
  assertEquals(snap.software.subtotal, 0);
  assertEquals(snap.top.totalCP, 0);
});

Deno.test("quote-snapshot — CP=0 功能不计（即便 inScope=true）", () => {
  const fn = makeFunctionListPayload({ category: "A", module: "B", name: "F1", cp: 0, inScope: true });
  const snap = computeQuoteSnapshot({
    functions: [fn],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: EMPTY_HARDWARE_ITEMS,
  });
  assertEquals(snap.software.subtotal, 0);
  assertEquals(snap.top.totalCP, 0);
});

Deno.test("quote-snapshot — groupedByCategory 按硬件 items 分组", () => {
  const hw = makeHardwareItemsPayload({
    items: [
      { category: "服务器", device: "S1", qty: 1, unitPrice: 1000, subtotal: 1000, spec: "", remarks: "" } as never,
      { category: "网络", device: "R1", qty: 1, unitPrice: 200, subtotal: 200, spec: "", remarks: "" } as never,
    ],
  });
  const snap = computeQuoteSnapshot({
    functions: [],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: hw,
  });
  assertEquals(snap.hardware.groupedByCategory.length, 2);
  assertEquals(snap.hardware.groupedByCategory[0].category, "服务器");
  assertEquals(snap.hardware.groupedByCategory[1].category, "网络");
});