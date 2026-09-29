/**
 * 任务 5：取消『提案 PPT 设计』AI 生成功能 —— 测试
 *
 * 验证：
 *   - PptView 不再有 "AI 生成" 按钮
 *   - PptView 不再有 openAi() 函数 / aiOpen ref / PptAiGenerateDialog 调用
 *   - 空状态文案不再提及「AI 生成」
 *   - PptAiGenerateDialog 文件保留（供后台或其他流程使用，component-level
 *     不被任何 UI 入口触发）
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b5 — PptView 顶部不再有「AI 生成」按钮", () => {
  const src = readText("frontend/src/features/business-module/components/PptView.vue");
  // 排除 HTML 注释
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  // 不应有 "AI 生成" 字样在 button 内
  assert(
    !/<button[^>]*>[\s]*AI\s*生成[\s]*<\/button>/.test(codeOnly),
    "不应再有「AI 生成」按钮元素",
  );
  // 不应有 openAi 调用
  assert(!codeOnly.includes("@click=\"openAi\""), "不应再有 openAi 点击绑定");
});

Deno.test("b5 — PptView 不再 import / 使用 PptAiGenerateDialog", () => {
  const src = readText("frontend/src/features/business-module/components/PptView.vue");
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  assert(!codeOnly.includes("PptAiGenerateDialog"), "PptAiGenerateDialog 不应再被引用");
  assert(!/aiOpen\s*=\s*ref\b/.test(codeOnly), "aiOpen ref 不应再存在");
  assert(!/function openAi\b/.test(codeOnly), "openAi 函数不应再存在");
});

Deno.test("b5 — PptView 空状态文案不再提及 AI", () => {
  const src = readText("frontend/src/features/business-module/components/PptView.vue");
  // 找出 v-if=\"pages.length === 0\" 块中的文案
  const m = src.match(/v-if="pages\.length === 0"[\s\S]*?<\/div>/);
  assert(m, "应能匹配到空状态 div");
  const block = m![0].replace(/<!--[\s\S]*?-->/g, "");
  assert(!block.includes("AI 生成"), "空状态文案不应再提及 AI 生成");
});

Deno.test("b5 — PptAiGenerateDialog 文件保留（组件可被其他流程触发）", () => {
  const src = readText("frontend/src/features/business-module/components/PptAiGenerateDialog.vue");
  assertStringIncludes(src, "PptAiGenerateDialog");
});