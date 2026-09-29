/**
 * 任务 1：取消项目详情中生成报价单按钮 —— 测试
 *
 * 验证：
 *   - ProjectDetailView 不再有"生成报价单"按钮
 *   - 不再有 onOpenQuote 函数 / quoteComposerStore 引用
 *   - QuoteView 模块（生成入口的真实位置）保留按钮
 *   - quote-composer.store.ts + QuoteAiDraftDialog.vue 文件仍存在（向后兼容）
 */

import { assert, assertStringIncludes } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = Deno.cwd();

function readText(rel: string): string {
  return Deno.readTextFileSync(join(projectRoot, rel));
}

Deno.test("b1 — ProjectDetailView 模板里不含「生成报价单」按钮", () => {
  const src = readText("frontend/src/features/project/ProjectDetailView.vue");
  const template = src.match(/<template>[\s\S]*?<\/template>/);
  assert(template);
  // 按钮 / 触发器都不能出现
  assert(!template[0].includes("onOpenQuote"), "模板不应含 onOpenQuote 触发");
  // 「生成报价单」字串在 ProjectDetailView 模板里不能出现（注释除外）
  // 排除注释：只统计不在 <!-- --> 块里的"生成报价单"
  const noComments = template[0].replace(/<!--[\s\S]*?-->/g, "");
  assert(!noComments.includes("生成报价单"), "模板里不应再有「生成报价单」按钮");
});

Deno.test("b1 — ProjectDetailView script setup 不再有 onOpenQuote / quoteComposerStore", () => {
  const src = readText("frontend/src/features/project/ProjectDetailView.vue");
  assert(!src.includes("onOpenQuote"), "script 不应再有 onOpenQuote");
  assert(!src.includes("quoteComposerStore"), "script 不应再有 quoteComposerStore");
  assert(!src.includes("useQuoteComposerStore"), "import 不应再有 useQuoteComposerStore");
});

Deno.test("b1 — QuoteView 模块内部仍有「生成报价单」按钮（真正入口）", () => {
  const src = readText("frontend/src/features/quote/components/QuoteView.vue");
  assertStringIncludes(src, "生成报价单");
});

Deno.test("b1 — 后端 quote-composer.store.ts 仍存在（向后兼容）", () => {
  assert(
    existsSync(join(projectRoot, "frontend/src/features/quote/stores/quote-composer.store.ts")),
    "quote-composer.store.ts 保留（不删 store 避免破坏其他模块）",
  );
  assert(
    existsSync(join(projectRoot, "frontend/src/features/quote/components/QuoteAiDraftDialog.vue")),
    "QuoteAiDraftDialog.vue 保留",
  );
});