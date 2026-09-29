/**
 * 任务 13+14：硬件清单新增表单分行 + 自定义页签 markdown 切换
 *
 * t13 (B13): 硬件清单新增弹窗：label + input 各占一行
 *   - label class 是 flex flex-col gap-1
 *   - 内部 label 文字用 div（不是 span）
 *
 * t14 (B14): 自定义页签切换时 MarkdownEditor 重新挂载
 *   - <MarkdownEditor :key="activeTab.id">
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b13 — 硬件清单新增表单 label / input 各占一行（flex-col + div label）", () => {
  const src = readText("frontend/src/features/business-module/components/HardwareItemsView.vue");
  // 6 个表单字段都用 flex-col gap-1
  const matches = src.match(/flex flex-col gap-1 text-xs text-slate-700/g) ?? [];
  assert(matches.length >= 6, `期望至少 6 个 flex-col gap-1 label，实际 ${matches.length}`);
  // 不应再用 <span> 包裹 label 文本（应改为 <div>）
  const dialogBlock = src.match(/<el-dialog[\s\S]*?<\/el-dialog>/);
  assert(dialogBlock, "应能匹配 el-dialog 块");
  const block = dialogBlock![0];
  assert(!/<span>类别<\/span>/.test(block), "label 文本不应再是 <span>");
  assert(!/<span>设备<\/span>/.test(block), "label 文本不应再是 <span>");
  assert(!/<span>规格/.test(block), "label 文本不应再是 <span>");
  assert(!/<span>数量<\/span>/.test(block), "label 文本不应再是 <span>");
  assert(!/<span>单价/.test(block), "label 文本不应再是 <span>");
  assert(!/<span>备注<\/span>/.test(block), "label 文本不应再是 <span>");
});

Deno.test("b14 — 自定义页签 MarkdownEditor 用 :key=activeTab.id 强制重挂载", () => {
  const src = readText("frontend/src/features/business-module/components/CustomPagesView.vue");
  // MarkdownEditor 有 :key="activeTab.id"
  assert(/<MarkdownEditor\s+:key="activeTab\.id"/.test(src));
  // watch(activeId) 还在（保持原行为）
  assert(/watch\(\s*activeId/.test(src));
  assertStringIncludes(src, "draft.value = t?.content ?? \"\"");
});