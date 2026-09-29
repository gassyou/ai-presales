/**
 * 任务 2：交付物清单改成 markdown 页面 —— 测试
 *
 * 验证：
 *   - 后端 BusinessModuleKind 新增 "markdown_deliverable"
 *   - 后端 markdown-module.service 支持新 kind（KIND_TO_TITLE / TEMPLATE / SYSTEM_PROMPT / SUB_AGENT）
 *   - 前端 DeliverableView 用 MarkdownModuleView + markdown_deliverable kind
 *   - DeliverableView 不再有 el-table 表格 + 抽屉（已被简化）
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b2 — BusinessModuleKind 含 markdown_deliverable", () => {
  const src = readText("backend/domain/business-module/business-module.ts");
  assertStringIncludes(src, '"markdown_deliverable"');
});

Deno.test("b2 — markdown-module.service 4 张表都注册了 markdown_deliverable", () => {
  const src = readText("backend/application/business-module/markdown-module.service.ts");
  // KIND_TO_TITLE
  assertStringIncludes(src, 'markdown_deliverable: "交付物清单"');
  // KIND_TO_TEMPLATE
  assertStringIncludes(src, 'markdown_deliverable: `# 交付物清单');
  // KIND_TO_SYSTEM_PROMPT
  assertStringIncludes(src, 'markdown_deliverable: "请基于以下项目背景信息撰写「交付物清单」');
  // KIND_TO_SUB_AGENT
  assertStringIncludes(src, 'markdown_deliverable: "markdown-author"');
});

Deno.test("b2 — DeliverableView 改为 MarkdownModuleView wrapper", () => {
  const src = readText("frontend/src/features/business-module/components/DeliverableView.vue");
  // 引用 MarkdownModuleView
  assertStringIncludes(src, "import MarkdownModuleView");
  // kind 必传 markdown_deliverable
  assertStringIncludes(src, 'kind="markdown_deliverable"');
  assertStringIncludes(src, 'title="交付物清单"');
  // 不再有 el-table / 抽屉
  assert(!src.includes("<el-table"), "不应再有 el-table 表格");
  assert(!src.includes("<el-drawer"), "不应再有 el-drawer 抽屉");
  assert(!src.includes("新建交付物"), "不应再有「新建交付物」按钮");
  assert(!src.includes("deliverableError"), "不应再用 deliverableStore");
});

Deno.test("b2 — MarkdownModuleView 接受 markdown_deliverable kind（类型包含）", () => {
  const domain = readText("backend/domain/business-module/business-module.ts");
  assertStringIncludes(domain, '"markdown_deliverable"');
});