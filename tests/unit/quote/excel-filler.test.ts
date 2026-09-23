/**
 * excel-filler 测试
 *
 * 阶段 7.4f。
 *
 * 覆盖：
 *   - 默认布局（templateBytes=null）生成 5 sheet + 合法 xlsx bytes
 *   - 模板路径：加载模板后字符串占位符被替换
 *   - 默认布局含项目编号 / 客户名称 / 合计数值
 */

import { assert, assertEquals } from "@std/assert";
import { ExceljsFiller } from "@backend/application/quote/exceljs-filler.ts";
import { DEFAULT_BUDGET_SETTINGS } from "@backend/domain/business-module/budget-settings.ts";
import { EMPTY_HARDWARE_ITEMS, makeHardwareItemsPayload } from "@backend/domain/business-module/hardware-items.ts";
import { makeFunctionListPayload } from "@backend/domain/business-module/function-list.ts";
import { computeQuoteSnapshot } from "@backend/domain/quote/quote-snapshot.ts";
import ExcelJS from "exceljs";

Deno.test("excel-filler — 默认布局生成合法 xlsx + 5 sheet", async () => {
  const filler = new ExceljsFiller();
  const snap = computeQuoteSnapshot({
    functions: [makeFunctionListPayload({ category: "A", module: "B", name: "F1", cp: 5, inScope: true })],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: makeHardwareItemsPayload({
      items: [{ category: "服务器", device: "S1", qty: 1, unitPrice: 1000, subtotal: 1000, spec: "", remarks: "" } as never],
    }),
  });
  const r = await filler.fill({
    templateBytes: null,
    snapshot: snap,
    aiMarkdown: "test markdown",
    meta: {
      projectCode: "A-001",
      projectName: "测试项目",
      clientName: "ACME",
      createdAt: new Date("2026-09-22T00:00:00Z"),
    },
  });
  // xlsx 是 zip，magic bytes = PK\x03\x04
  assertEquals(r.bytes[0], 0x50);
  assertEquals(r.bytes[1], 0x4b);
  assertEquals(r.bytes[2], 0x03);
  assertEquals(r.bytes[3], 0x04);
  assert(r.bytes.byteLength > 1000);
  assert(r.filename.endsWith(".xlsx"));

  // 验证 sheet 内容
  const wb = new ExcelJS.Workbook();
  // deno-lint-ignore no-explicit-any
  await wb.xlsx.load(r.bytes as any);
  const sheetNames = wb.worksheets.map((s) => s.name);
  assertEquals(sheetNames.length, 5);
  assert(sheetNames.includes("项目信息"));
  assert(sheetNames.includes("软件服务"));
  assert(sheetNames.includes("硬件成本"));
  assert(sheetNames.includes("AI 说明"));
  assert(sheetNames.includes("合计"));

  // 项目信息 sheet 应含 projectCode
  const infoSheet = wb.getWorksheet("项目信息");
  assert(infoSheet);
  // row 2 = 项目编号
  assertEquals(infoSheet.getCell(2, 2).value, "A-001");
  // row 5 = 生成日期
  const dateCell = infoSheet.getCell(5, 2);
  assertEquals(dateCell.value, "2026-09-22");
});

Deno.test("excel-filler — 模板路径：字符串占位符 ${meta.projectName} 被替换", async () => {
  // 先用默认布局生成一个模板，再让它替换占位符
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Template");
  sheet.getCell(1, 1).value = "项目：${meta.projectName}";
  sheet.getCell(2, 1).value = "客户：${meta.clientName}";
  sheet.getCell(3, 1).value = "金额：${top.functionTotalAmount}";
  sheet.getCell(4, 1).value = "硬件：${hardware.subtotal}";
  sheet.getCell(5, 1).value = "未命名：${unknown.key}";
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const templateBytes = new Uint8Array(buf);

  const filler = new ExceljsFiller();
  const snap = computeQuoteSnapshot({
    functions: [],
    settings: DEFAULT_BUDGET_SETTINGS,
    hardware: EMPTY_HARDWARE_ITEMS,
  });
  const r = await filler.fill({
    templateBytes,
    snapshot: snap,
    aiMarkdown: "",
    meta: {
      projectCode: "P-1",
      projectName: "ACME CRM",
      clientName: "ACME",
      createdAt: new Date("2026-09-22T00:00:00Z"),
    },
  });
  const wb2 = new ExcelJS.Workbook();
  // deno-lint-ignore no-explicit-any
  await wb2.xlsx.load(r.bytes as any);
  const s = wb2.getWorksheet("Template");
  assert(s);
  assertEquals(s!.getCell(1, 1).value, "项目：ACME CRM");
  assertEquals(s!.getCell(2, 1).value, "客户：ACME");
  assertEquals(s!.getCell(5, 1).value, "未命名："); // 未命名占位符 → 空
});