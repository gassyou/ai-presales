/**
 * hardware-items.ts 域纯函数测试
 *
 * 阶段 7.4f。
 */

import { assert, assertEquals } from "@std/assert";
import {
  makeHardwareItem,
  makeHardwareItemsPayload,
  parseHardwareItemsPayload,
  computeSubtotal,
  totalSubtotal,
  groupByCategory,
  validateHardwareItemInput,
  HARDWARE_ITEMS_KIND,
} from "@backend/domain/business-module/hardware-items.ts";

Deno.test("hardware-items — makeHardwareItem 默认值", () => {
  const it = makeHardwareItem();
  assertEquals(it.qty, 1);
  assertEquals(it.unitPrice, 0);
  assertEquals(it.subtotal, 0);
  assertEquals(it.category, "");
});

Deno.test("hardware-items — parseHardwareItemsPayload 失败兜底", () => {
  assertEquals(parseHardwareItemsPayload("{not json").items.length, 0);
  assertEquals(parseHardwareItemsPayload(JSON.stringify({ items: [{ category: "A", device: "B", spec: "", qty: 2, unitPrice: 100, subtotal: 200, remarks: "" }] })).items.length, 1);
  // 非法 items 数组 → 兜底
  assertEquals(parseHardwareItemsPayload(JSON.stringify({ items: "not array" })).items.length, 0);
});

Deno.test("hardware-items — computeSubtotal(qty=2, unitPrice=100) = 200", () => {
  assertEquals(computeSubtotal({ qty: 2, unitPrice: 100 }), 200);
  assertEquals(computeSubtotal({ qty: 0, unitPrice: 100 }), 0); // qty<1 时 floor 为 0
  assertEquals(computeSubtotal({ qty: 2, unitPrice: -10 }), 0); // 负单价兜底 0
});

Deno.test("hardware-items — totalSubtotal 求和正确", () => {
  const p = makeHardwareItemsPayload({
    items: [
      { qty: 2, unitPrice: 100, subtotal: 200 } as never,
      { qty: 3, unitPrice: 50, subtotal: 150 } as never,
    ],
  });
  assertEquals(totalSubtotal(p), 350);
});

Deno.test("hardware-items — groupByCategory 分组（首次出现顺序）", () => {
  const p = makeHardwareItemsPayload({
    items: [
      { category: "服务器", device: "S1", qty: 1, unitPrice: 1000, subtotal: 1000 } as never,
      { category: "服务器", device: "S2", qty: 2, unitPrice: 500, subtotal: 1000 } as never,
      { category: "网络", device: "R1", qty: 1, unitPrice: 200, subtotal: 200 } as never,
    ],
  });
  const groups = groupByCategory(p);
  assertEquals(groups.length, 2);
  assertEquals(groups[0].category, "服务器");
  assertEquals(groups[0].items.length, 2);
  assertEquals(groups[0].subtotal, 2000);
  assertEquals(groups[1].category, "网络");
  assertEquals(groups[1].subtotal, 200);
});

Deno.test("hardware-items — validateHardwareItemInput 校验", () => {
  assertEquals(validateHardwareItemInput({ qty: 0, unitPrice: 1 }), "qty_invalid");
  assertEquals(validateHardwareItemInput({ qty: 1.5, unitPrice: 1 }), "qty_invalid");
  assertEquals(validateHardwareItemInput({ qty: -1, unitPrice: 1 }), "qty_invalid");
  assertEquals(validateHardwareItemInput({ qty: 1, unitPrice: -1 }), "unitPrice_invalid");
  assertEquals(validateHardwareItemInput({ qty: 1, unitPrice: 0 }), null);
  assertEquals(validateHardwareItemInput({ qty: 5, unitPrice: 100 }), null);
});

Deno.test("hardware-items — HARDWARE_ITEMS_KIND = 'hardware_items'", () => {
  assertEquals(HARDWARE_ITEMS_KIND, "hardware_items");
});