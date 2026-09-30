/**
 * 任务：项目计划模块（及其他 markdown_*）暴露为 AI 可操作的 tool —— 测试
 *
 * 验证：
 *   - update_markdown_module: ALLOWED_MARKDOWN_KINDS 含 project_plan + deliverable
 *   - update_markdown_module: description 提到 kind=project_plan / kind=deliverable
 *   - 新增 read_markdown_module tool:
 *       - 名字 = "read_markdown_module"
 *       - sideEffect = "read"（不需审批）
 *       - inputSchema: projectCodeOrName + kind（13 种）
 *       - 调用 service.get(projectId, kind) 拿全模块正文
 *       - 未找到返 found=false
 *   - buildWriteableTools 返回含 read_markdown_module
 *   - main.ts 装配了 markdownModuleServiceForWrites
 */

import { assert, assertStringIncludes, assertEquals } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("tm1 — ALLOWED_MARKDOWN_KINDS 含 markdown_project_plan + markdown_deliverable", () => {
  const src = readText("backend/ai/tool/builtin/writeable-tools.ts");
  // 抓出 ALLOWED_MARKDOWN_KINDS 数组
  const m = src.match(/const ALLOWED_MARKDOWN_KINDS: readonly BusinessModuleKind\[\] = \[[\s\S]*?\];/);
  assert(m, "应能匹配 ALLOWED_MARKDOWN_KINDS 数组");
  const block = m![0];
  assertStringIncludes(block, '"markdown_project_plan"');
  assertStringIncludes(block, '"markdown_deliverable"');
});

Deno.test("tm2 — update_markdown_module description 列出 13 种 kind 含 project_plan / deliverable", () => {
  const src = readText("backend/ai/tool/builtin/writeable-tools.ts");
  // 抓 description（以 readonly description = "写入..." 开头，到默认采用覆盖式为止）
  const m = src.match(/class UpdateMarkdownModuleTool[\s\S]*?readonly description = [\s\S]*?默认采用覆盖式/);
  assert(m, "应能匹配 UpdateMarkdownModuleTool.description");
  const desc = m![0];
  assertStringIncludes(desc, "project_plan");
  assertStringIncludes(desc, "deliverable");
  assertStringIncludes(desc, "13");
});

Deno.test("tm3 — 新增 ReadMarkdownModuleTool 类", () => {
  const src = readText("backend/ai/tool/builtin/writeable-tools.ts");
  assertStringIncludes(src, "class ReadMarkdownModuleTool");
  assertStringIncludes(src, 'readonly name = "read_markdown_module"');
  assertStringIncludes(src, 'readonly sideEffect: "read" = "read"');
  // requiresApproval 应为 false
  assert(/class ReadMarkdownModuleTool[\s\S]*?readonly requiresApproval = false/.test(src));
});

Deno.test("tm4 — ReadMarkdownModuleTool inputSchema: projectCodeOrName + kind (13 种)", () => {
  const src = readText("backend/ai/tool/builtin/writeable-tools.ts");
  // 抓出 inputSchema
  const m = src.match(/class ReadMarkdownModuleTool[\s\S]*?readonly sideEffect: "read" = "read";/);
  assert(m, "应能匹配 ReadMarkdownModuleTool 类体");
  const body = m![0];
  assertStringIncludes(body, 'projectCodeOrName: { type: "string" }');
  // kind 引用 ALLOWED_MARKDOWN_KINDS
  assertStringIncludes(body, "ALLOWED_MARKDOWN_KINDS as unknown as string[]");
  // required 字段
  assertStringIncludes(body, 'required: ["projectCodeOrName", "kind"]');
});

Deno.test("tm5 — ReadMarkdownModuleTool execute 调用 service.get 并返回 found=false/true", () => {
  const src = readText("backend/ai/tool/builtin/writeable-tools.ts");
  // 用唯一 anchor: constructor → execute 收尾
  const m = src.match(/class ReadMarkdownModuleTool[\s\S]*?constructor[\s\S]*?async execute[\s\S]*?\n  \}\n\}/);
  assert(m, "应能匹配 ReadMarkdownModuleTool.execute 实现");
  const body = m![0];
  assertStringIncludes(body, "markdownModuleService.get(");
  assertStringIncludes(body, "found: false");
  assertStringIncludes(body, "found: true");
  // 校验 ALLOWED_MARKDOWN_KINDS
  assertStringIncludes(body, "ALLOWED_MARKDOWN_KINDS.includes(args.kind)");
});

Deno.test("tm6 — WriteableToolsDeps + buildWriteableTools 注册 ReadMarkdownModuleTool", () => {
  const src = readText("backend/ai/tool/builtin/writeable-tools.ts");
  // deps 含 markdownModuleService
  assert(/export interface WriteableToolsDeps[\s\S]*?markdownModuleService: MarkdownModuleService/.test(src));
  // buildWriteableTools 注册
  assert(/buildWriteableTools[\s\S]*?new ReadMarkdownModuleTool\(\{[\s\S]*?markdownModuleService: deps\.markdownModuleService/.test(src));
});

Deno.test("tm7 — main.ts 装配 markdownModuleServiceForWrites 并注入 deps", () => {
  const src = readText("main.ts");
  assertStringIncludes(src, "markdownModuleServiceForWrites");
  // MarkdownModuleService 实例化（用 businessModuleServiceForWrites）
  assert(
    /const markdownModuleServiceForWrites = new MarkdownModuleService\(\{[\s\S]*?businessModuleService: businessModuleServiceForWrites/.test(
      src,
    ),
    "markdownModuleServiceForWrites 应复用 businessModuleServiceForWrites",
  );
  // 注入到 deps
  assert(/registerWriteableTools\(toolRegistry,\s*\{[\s\S]*?markdownModuleService: markdownModuleServiceForWrites/.test(src));
});