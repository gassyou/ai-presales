/**
 * 任务：报价单组下新增「项目计划」模块 —— 测试
 *
 * 验证：
 *   - 后端 BusinessModuleKind 新增 "markdown_project_plan"
 *   - 后端 markdown-module.service 注册新 kind（4 张表：TITLE / TEMPLATE / SYSTEM_PROMPT / SUB_AGENT）
 *   - 前端 ProjectDetailView nav 新增 "项目计划" 子项
 *   - 前端 ModuleKey 类型含 "md_project_plan" + "project-plan"
 *   - 前端 MARKDOWN_MODULES 含 md_project_plan 映射
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("pp1 — 后端 BusinessModuleKind 含 markdown_project_plan", () => {
  const src = readText("backend/domain/business-module/business-module.ts");
  assertStringIncludes(src, '"markdown_project_plan"');
});

Deno.test("pp2 — 后端 markdown-module.service 注册新 kind 在 4 张表里", () => {
  const src = readText("backend/application/business-module/markdown-module.service.ts");
  // KIND_TO_TITLE
  assertStringIncludes(src, 'markdown_project_plan: "项目计划"');
  // KIND_TO_TEMPLATE
  assertStringIncludes(src, "markdown_project_plan: `# 项目计划");
  // KIND_TO_SYSTEM_PROMPT
  assertStringIncludes(src, 'markdown_project_plan: "请基于以下项目背景信息撰写「项目计划」');
  // KIND_TO_SUB_AGENT
  assertStringIncludes(src, 'markdown_project_plan: "markdown-author"');
});

Deno.test("pp3 — 前端 ProjectDetailView nav 报价单组下新增「项目计划」子项", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  const codeOnly = v.replace(/<!--[\s\S]*?-->/g, "");
  // nav 里 报价单 子项 + 项目计划 子项
  assert(
    /key: "quote"[\s\S]*?key: "project-plan", label: "项目计划"/.test(codeOnly),
    "nav 中应先有报价单，再有项目计划",
  );
});

Deno.test("pp4 — 前端 ModuleKey 类型含 md_project_plan + project-plan", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  const m = v.match(/type ModuleKey =[\s\S]*?;/);
  assert(m, "应能匹配 ModuleKey 类型定义");
  const block = m![0];
  assertStringIncludes(block, '"md_project_plan"');
  assertStringIncludes(block, '"project-plan"');
});

Deno.test("pp5 — 前端 MARKDOWN_MODULES 含 md_project_plan 映射", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  assert(
    /md_project_plan:\s*\{\s*kind:\s*"markdown_project_plan",\s*title:\s*"项目计划"\s*\}/.test(
      v,
    ),
    "MARKDOWN_MODULES.md_project_plan 应映射到 markdown_project_plan",
  );
});