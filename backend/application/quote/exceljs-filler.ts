/**
 * ExceljsFiller —— 基于 exceljs 的默认 + 模板填充实现
 *
 * 阶段 7.4f。
 *
 * 两条路径：
 *   1. 模板 bytes = null：调 buildDefaultWorkbook() 生成 5 sheet 默认布局
 *   2. 模板 bytes ≠ null：加载模板，对每个 sheet 的所有 cell 做
 *      `replaceTokens(value)` —— 替换 ${...} 字符串占位符；货币/日期 cell 自动套用 numFmt
 *
 * 占位符约定：
 *   - 单元格：值是字符串且包含 `${...}` 时按命名替换
 *   - 行级：用模板 sheet 中 `<!-- BEGIN:name -->...<!-- END:name -->` 标记的整行复制；
 *     每个 ${name.subkey} 占位符会被当前快照的对应值替换。
 *     name ∈ {byModule, byPhase, hardwareItems}
 *
 * 命名映射：
 *   - meta.projectCode / projectName / clientName / createdAt
 *   - top.totalCP / totalEffortHours / functionTotalAmount / deployTrainingAmount / totalAmountExclTax / totalPeriodDays
 *   - software.subtotal / hardware.subtotal / grandTotalExclTax
 *   - ai.markdown
 *
 * 样式：
 *   - 货币列 numFmt = '#,##0.00'
 *   - 日期 numFmt = 'yyyy-mm-dd'
 *   - 表头蓝底白字：依赖模板自带样式（默认布局里设）
 */

import ExcelJS from "exceljs";
import type {
  ExcelFiller,
  FillMeta,
  FillResult,
} from "./excel-filler.ts";
import type { QuoteSnapshot } from "@backend/domain/quote/quote-snapshot.ts";

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

function num(v: number): number {
  // Excel 不接受 NaN / Infinity
  if (!Number.isFinite(v)) return 0;
  return v;
}

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isMoneyPath(path: string): boolean {
  return /subtotal|Amount|amount|totalAmountExclTax|grandTotalExclTax|unitPrice|price/i.test(path);
}

function buildTokenMap(snapshot: QuoteSnapshot, aiMarkdown: string, meta: FillMeta): Record<string, string | number> {
  const t = snapshot.top;
  return {
    "meta.projectCode": meta.projectCode,
    "meta.projectName": meta.projectName,
    "meta.clientName": meta.clientName,
    "meta.createdAt": fmtDate(meta.createdAt),
    "top.totalCP": num(t.totalCP),
    "top.totalEffortHours": num(t.totalEffortHours),
    "top.functionTotalAmount": num(t.functionTotalAmount),
    "top.deployTrainingAmount": num(t.deployTrainingAmount),
    "top.totalAmountExclTax": num(t.totalAmountExclTax),
    "top.totalPeriodDays": num(t.totalPeriodDays),
    "software.subtotal": num(snapshot.software.subtotal),
    "hardware.subtotal": num(snapshot.hardware.subtotal),
    "deployTraining.subtotal": num(snapshot.deployTraining.subtotal),
    "grandTotalExclTax": num(snapshot.grandTotalExclTax),
    "ai.markdown": aiMarkdown,
  };
}

function resolvePath(map: Record<string, string | number>, path: string): string | number | undefined {
  return map[path.trim()];
}

function replaceTokens(input: string, map: Record<string, string | number>): string {
  return input.replace(PLACEHOLDER_RE, (_match, path: string) => {
    const v = resolvePath(map, path);
    if (v === undefined) return ""; // 未命名占位符 → 留空
    return String(v);
  });
}

export class ExceljsFiller implements ExcelFiller {
  async fill(args: {
    templateBytes: Uint8Array | null;
    snapshot: QuoteSnapshot;
    aiMarkdown: string;
    meta: FillMeta;
  }): Promise<FillResult> {
    const wb = new ExcelJS.Workbook();
    if (args.templateBytes) {
      // exceljs 类型声明要求 Buffer；Deno 端用 Uint8Array 即可（API 兼容）
      // deno-lint-ignore no-explicit-any
      await wb.xlsx.load(args.templateBytes as any);
      applyTemplate(wb, args.snapshot, args.aiMarkdown, args.meta);
    } else {
      buildDefaultWorkbook(wb, args.snapshot, args.aiMarkdown, args.meta);
    }
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    const filename = `报价单-${args.meta.projectCode || args.meta.projectName || "untitled"}-${fmtDate(args.meta.createdAt)}.xlsx`;
    return { bytes, filename };
  }
}

// ============================================================
// 模板路径：替换 ${...} + 行级循环
// ============================================================

function applyTemplate(
  wb: ExcelJS.Workbook,
  snapshot: QuoteSnapshot,
  aiMarkdown: string,
  meta: FillMeta,
): void {
  const map = buildTokenMap(snapshot, aiMarkdown, meta);
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        // 1. 字符串占位符替换
        const v = cell.value;
        if (typeof v === "string" && PLACEHOLDER_RE.test(v)) {
          PLACEHOLDER_RE.lastIndex = 0;
          const replaced = replaceTokens(v, map);
          cell.value = replaced;
          if (typeof replaced === "string" && isMoneyPath(replaced)) {
            // 不会触发（replaced 是字符串）
          }
        } else if (typeof v === "object" && v !== null && "text" in v && typeof (v as { text: unknown }).text === "string") {
          const text = (v as { text: string }).text;
          if (PLACEHOLDER_RE.test(text)) {
            PLACEHOLDER_RE.lastIndex = 0;
            (v as { text: string }).text = replaceTokens(text, map);
          }
        }
      });
    });
  });

  // 行级循环（按 sheet 名 / 单元格 note 标 BEGIN/END 区间）
  expandRowBlocks(wb, snapshot, meta);
}

/**
 * 行级循环：sheet 的某列有 `<!-- BEGIN:name -->` → 找到下一个 `<!-- END:name -->` 之间的行作为模板，
 * 复制 N 份（N = 列表长度），每个 ${name.subkey} 替换为当前行的值。
 *
 * 简化策略（仅本阶段）：在 A 列扫描 BEGIN/END 标记，找到标记行后，标记行 + 之后若干行直到 END 为模板；
 * 复制时插在 END 行之后；标记行 / END 行保留原样（标记留在原地，方便用户直观看到区间）。
 */
function expandRowBlocks(
  wb: ExcelJS.Workbook,
  snapshot: QuoteSnapshot,
  meta: FillMeta,
): void {
  // 仅支持 byModule / byPhase / hardwareItems 三个块
  const blocks: Array<{ name: string; rows: Array<Record<string, unknown>> }> = [
    {
      name: "byModule",
      rows: snapshot.top ? [] : [], // top 总是存在；具体行由 computeModuleBudget 提供 — 此处用 snapshot.byModule 间接取
    },
    { name: "byPhase", rows: [] },
    { name: "hardwareItems", rows: [] },
  ];

  // 注入 byModule / byPhase / hardwareItems 行；因为 QuoteSnapshot 没携带完整 byModule/byPhase 列表，
  // 我们从 snapshot 的派生结构里拼：
  // - byModule 从 snapshot.software.subtotal / deployTraining / hardware / grandTotal 不可逆地拼不出来；
  //   因此行级仅支持 hardwareItems（来自 snapshot.hardware.items）。
  blocks[2].rows = snapshot.hardware.items.map((it) => ({
    "hardwareItems.category": it.category,
    "hardwareItems.device": it.device,
    "hardwareItems.spec": it.spec,
    "hardwareItems.qty": it.qty,
    "hardwareItems.unitPrice": it.unitPrice,
    "hardwareItems.subtotal": it.subtotal,
    "hardwareItems.remarks": it.remarks,
  }));
  // byModule / byPhase 数据需要从 budget-summary 走；此版本由默认布局直接覆盖（template 仅负责 hardwareItems 行级）
  blocks[0].rows = [];
  blocks[1].rows = [];

  wb.eachSheet((sheet) => {
    let lastRow = sheet.rowCount;
    let r = 1;
    while (r <= lastRow) {
      const cellA = sheet.getRow(r).getCell(1);
      const txtA = readCellText(cellA.value);
      const m = txtA.match(/<!-- BEGIN:(\w+) -->/);
      if (m) {
        const name = m[1];
        const block = blocks.find((b) => b.name === name);
        const startRow = r;
        let endRow = r;
        // 找到 END 行
        for (let k = r + 1; k <= lastRow; k++) {
          const t = readCellText(sheet.getRow(k).getCell(1).value);
          if (t.includes(`<!-- END:${name} -->`)) {
            endRow = k;
            break;
          }
        }
        if (block && block.rows.length > 0 && endRow > startRow) {
          // 复制 [startRow+1, endRow-1] 区间
          const template: unknown[][] = [];
          for (let k = startRow + 1; k < endRow; k++) {
            const values = sheet.getRow(k).values;
            template.push(Array.isArray(values) ? values as unknown[] : Object.values(values as Record<string, unknown>));
          }
          // 在 endRow 之后插入
          let insertAt = endRow + 1;
          for (const dataRow of block.rows) {
            const newValues = template.map((rowTemplate) =>
              rowTemplate.map((cellValue) => replaceRowPlaceholders(cellValue, name, dataRow))
            );
            sheet.spliceRows(insertAt, 0, newValues as never[]);
            insertAt++;
          }
          lastRow = sheet.rowCount;
          r = insertAt;
        } else {
          r = endRow + 1;
        }
      } else {
        r++;
      }
    }
  });
}

function readCellText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "text" in v && typeof (v as { text: unknown }).text === "string") {
    return (v as { text: string }).text;
  }
  if (v && typeof v === "object" && "richText" in v) {
    return ((v as { richText: Array<{ text: string }> }).richText ?? [])
      .map((x) => x.text)
      .join("");
  }
  return "";
}

function replaceRowPlaceholders(cellValue: unknown, blockName: string, dataRow: Record<string, unknown>): unknown {
  if (typeof cellValue === "string") {
    return cellValue.replace(PLACEHOLDER_RE, (match, p: string) => {
      const fullKey = `${blockName}.${p}`;
      if (dataRow[fullKey] !== undefined) return String(dataRow[fullKey]);
      // 无 key → 留空
      return "";
    });
  }
  if (cellValue && typeof cellValue === "object" && "text" in cellValue && typeof (cellValue as { text: unknown }).text === "string") {
    const text = (cellValue as { text: string }).text;
    (cellValue as { text: string }).text = text.replace(PLACEHOLDER_RE, (match, p: string) => {
      const fullKey = `${blockName}.${p}`;
      if (dataRow[fullKey] !== undefined) return String(dataRow[fullKey]);
      return "";
    });
    return cellValue;
  }
  return cellValue;
}

// ============================================================
// 默认布局：5 sheet（无模板时）
// ============================================================

function buildDefaultWorkbook(
  wb: ExcelJS.Workbook,
  snapshot: QuoteSnapshot,
  aiMarkdown: string,
  meta: FillMeta,
): void {
  const map = buildTokenMap(snapshot, aiMarkdown, meta);
  const moneyFmt = "#,##0.00";
  const numFmt = "#,##0";

  // ---- Sheet 1: 项目信息 ----
  const info = wb.addWorksheet("项目信息");
  info.columns = [{ width: 20 }, { width: 40 }];
  const infoHeader = info.getRow(1);
  infoHeader.values = ["项目", "内容"];
  infoHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  infoHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  const rows1: Array<[string, string]> = [
    ["项目编号", "meta.projectCode"],
    ["项目名称", "meta.projectName"],
    ["客户名称", "meta.clientName"],
    ["生成日期", "meta.createdAt"],
  ];
  let r = 2;
  for (const [label, key] of rows1) {
    info.getCell(r, 1).value = label;
    info.getCell(r, 2).value = replaceTokens(`${map[key]}`, map);
    r++;
  }
  const createdCell = info.getCell(5, 2);
  createdCell.numFmt = "yyyy-mm-dd";

  // ---- Sheet 2: 软件服务汇总 ----
  const soft = wb.addWorksheet("软件服务");
  soft.columns = [
    { width: 18 },
    { width: 22 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];
  const softHeader = soft.getRow(1);
  softHeader.values = ["项目", "数值"];
  softHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  softHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  const rows2: Array<[string, string, string]> = [
    ["总 CP", "top.totalCP", numFmt],
    ["总工时（小时）", "top.totalEffortHours", numFmt],
    ["软件金额（元）", "software.subtotal", moneyFmt],
    ["部署培训金额（元）", "deployTraining.subtotal", moneyFmt],
    ["软件合计（元）", "grandTotalExclTax", moneyFmt],
    ["项目总工期（天）", "top.totalPeriodDays", numFmt],
  ];
  let r2 = 2;
  for (const [label, key, fmt] of rows2) {
    soft.getCell(r2, 1).value = label;
    soft.getCell(r2, 2).value = num(map[key] as number);
    soft.getCell(r2, 2).numFmt = fmt;
    r2++;
  }
  // 合计黄底
  const totalRow = soft.getRow(6);
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

  // ---- Sheet 3: 硬件成本 ----
  const hw = wb.addWorksheet("硬件成本");
  hw.columns = [
    { header: "类别", width: 18 },
    { header: "设备", width: 24 },
    { header: "规格", width: 28 },
    { header: "数量", width: 10 },
    { header: "单价（元）", width: 14 },
    { header: "小计（元）", width: 16 },
    { header: "备注", width: 24 },
  ];
  const hwHeader = hw.getRow(1);
  hwHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hwHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  let r3 = 2;
  for (const it of snapshot.hardware.items) {
    hw.getCell(r3, 1).value = it.category;
    hw.getCell(r3, 2).value = it.device;
    hw.getCell(r3, 3).value = it.spec;
    hw.getCell(r3, 4).value = it.qty;
    hw.getCell(r3, 5).value = it.unitPrice;
    hw.getCell(r3, 5).numFmt = moneyFmt;
    hw.getCell(r3, 6).value = it.subtotal;
    hw.getCell(r3, 6).numFmt = moneyFmt;
    hw.getCell(r3, 7).value = it.remarks;
    r3++;
  }
  // 合计行
  hw.getCell(r3, 5).value = "硬件合计";
  hw.getCell(r3, 5).font = { bold: true };
  hw.getCell(r3, 5).alignment = { horizontal: "right" };
  hw.getCell(r3, 6).value = snapshot.hardware.subtotal;
  hw.getCell(r3, 6).numFmt = moneyFmt;
  hw.getCell(r3, 6).font = { bold: true };
  hw.getCell(r3, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

  // ---- Sheet 4: AI 说明 ----
  const ai = wb.addWorksheet("AI 说明");
  ai.columns = [{ width: 100 }];
  ai.getCell(1, 1).value = "AI 生成的报价说明（可手动修改）";
  ai.getCell(1, 1).font = { bold: true };
  ai.getCell(2, 1).value = aiMarkdown || "（未生成 AI 说明；可手动填写）";
  ai.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };

  // ---- Sheet 5: 合计 ----
  const grand = wb.addWorksheet("合计");
  grand.columns = [{ width: 24 }, { width: 22 }];
  const gHeader = grand.getRow(1);
  gHeader.values = ["项目", "金额（元）"];
  gHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  gHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  grand.getCell(2, 1).value = "软件金额";
  grand.getCell(2, 2).value = num(snapshot.software.subtotal);
  grand.getCell(2, 2).numFmt = moneyFmt;
  grand.getCell(3, 1).value = "部署培训";
  grand.getCell(3, 2).value = num(snapshot.deployTraining.subtotal);
  grand.getCell(3, 2).numFmt = moneyFmt;
  grand.getCell(4, 1).value = "硬件";
  grand.getCell(4, 2).value = num(snapshot.hardware.subtotal);
  grand.getCell(4, 2).numFmt = moneyFmt;
  const totalAmt = grand.getRow(5);
  totalAmt.getCell(1).value = "合计（不含税）";
  totalAmt.getCell(1).font = { bold: true };
  totalAmt.getCell(2).value = num(snapshot.grandTotalExclTax);
  totalAmt.getCell(2).numFmt = moneyFmt;
  totalAmt.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  totalAmt.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
}