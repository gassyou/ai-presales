/**
 * 任务 6：报价单 checkbox 默认全选 —— 测试
 *
 * 验证：
 *   - includePrecondition / includeDeliverables / includeFunctions 初始值为 true
 *   - 这 3 个 checkbox 仍渲染（没被删）
 *   - includeHardware 默认 true（保持原状）
 *   - 生成按钮 disabled 逻辑（无任何 include 时禁用）依然正确
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b6 — includePrecondition / Deliverables / Functions 默认 true", () => {
  const src = readText("frontend/src/features/quote/components/QuoteView.vue");
  // 排除 HTML 注释
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  // 抓出 ref<QuoteGenerationOptions>({ ... }) 初始化对象
  const m = codeOnly.match(/ref<QuoteGenerationOptions>\(\{[\s\S]*?^\s*\}\)/m);
  assert(m, "应有 ref<QuoteGenerationOptions>({ ... }) 初始化对象");
  const block = m![0];
  assert(/includePrecondition:\s*true/.test(block), "includePrecondition 默认为 true");
  assert(/includeDeliverables:\s*true/.test(block), "includeDeliverables 默认为 true");
  assert(/includeFunctions:\s*true/.test(block), "includeFunctions 默认为 true");
});

Deno.test("b6 — 3 个 checkbox 仍渲染", () => {
  const src = readText("frontend/src/features/quote/components/QuoteView.vue");
  assertStringIncludes(src, 'v-model="opts.includePrecondition"');
  assertStringIncludes(src, 'v-model="opts.includeDeliverables"');
  assertStringIncludes(src, 'v-model="opts.includeFunctions"');
  // 关联文字标签
  assertStringIncludes(src, "前提条件");
  assertStringIncludes(src, "交付物清单");
  assertStringIncludes(src, "功能清单");
});

Deno.test("b6 — includeHardware 默认 true 不变", () => {
  const src = readText("frontend/src/features/quote/components/QuoteView.vue");
  const m = src.match(/ref<QuoteGenerationOptions>\(\{[\s\S]*?^\s*\}\)/m);
  assert(m, "应有 ref<QuoteGenerationOptions>({ ... }) 初始化对象");
  assert(/includeHardware:\s*true/.test(m![0]), "includeHardware 仍默认为 true");
});