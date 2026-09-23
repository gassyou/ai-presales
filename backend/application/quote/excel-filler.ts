/**
 * ExcelFiller —— 报价单 Excel 生成抽象
 *
 * 阶段 7.4f。
 *
 * 设计要点：
 *   - Filler 接口只暴露 fill()；测试可注入假实现
 *   - 默认实现 ExceljsFiller：
 *     - 若 `templateBytes` 为空 → 用 `buildDefaultWorkbook()` 生成默认布局（不依赖资源文件）
 *     - 若 `templateBytes` 非空 → 加载模板，按 `${placeholder}` 命名替换字符串占位符；
 *       行级占位符用 `<!-- BEGIN:name --><row>...</row><!-- END:name -->` 区间复制
 *     - 所有替换均在内存内完成，再 writeBuffer 出 bytes
 *   - 默认样式：表头蓝底白字、合计黄底、货币 '#,##0.00'、日期 'yyyy-mm-dd'
 */

import type { QuoteSnapshot } from "@backend/domain/quote/quote-snapshot.ts";

export interface FillMeta {
  projectCode: string;
  projectName: string;
  clientName: string;
  createdAt: Date;
}

export interface FillResult {
  bytes: Uint8Array;
  filename: string; // 建议文件名（含 .xlsx）
}

export interface ExcelFiller {
  fill(args: {
    templateBytes: Uint8Array | null; // null = 无模板，用默认布局
    snapshot: QuoteSnapshot;
    aiMarkdown: string;
    meta: FillMeta;
  }): Promise<FillResult>;
}