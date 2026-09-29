/**
 * 任务 3：markdown 编辑器占满全屏 —— 测试
 *
 * 验证：
 *   - MarkdownEditor 不再有 min-height: 320px（应让父容器控制高度）
 *   - MarkdownEditor 保留 flex: 1 1 auto（自适应父容器高度）
 *   - MarkdownModuleView 父容器仍是 flex-1 + h-full
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b3 — MarkdownEditor 不再含 min-height: 320px", () => {
  const src = readText("frontend/src/shared/ui/MarkdownEditor.vue");
  // 任何 min-height: 320px 在 bytemd 上都已移除
  assert(!src.includes("min-height: 320px"), "不应再硬编码 min-height 320px");
});

Deno.test("b3 — MarkdownEditor 内 .md-editor-wrapper 是 flex 容器", () => {
  const src = readText("frontend/src/shared/ui/MarkdownEditor.vue");
  // 顶层 wrapper 必须是 flex+flex-1 auto，让父 h-full 撑开
  assertStringIncludes(src, ".md-editor-wrapper {");
  assertStringIncludes(src, "display: flex");
  assertStringIncludes(src, "flex-direction: column");
  assertStringIncludes(src, "flex: 1 1 auto");
});

Deno.test("b3 — bytemd 容器 flex: 1 1 auto（占满父容器）", () => {
  const src = readText("frontend/src/shared/ui/MarkdownEditor.vue");
  // .bytemd 强制 flex: 1 1 auto（接替 min-height）
  assertStringIncludes(src, ".md-editor-wrapper :deep(.bytemd) {");
  // 至少一处 flex: 1 1 auto 出现
  const matches = src.match(/flex: 1 1 auto/g) ?? [];
  assert(matches.length >= 2, `期望至少 2 处 flex: 1 1 auto，实际 ${matches.length}`);
});

Deno.test("b3 — MarkdownModuleView 是 flex h-full flex-1 flex-col 容器", () => {
  const src = readText("frontend/src/features/business-module/components/MarkdownModuleView.vue");
  assertStringIncludes(src, "card flex h-full min-h-0 flex-1 flex-col");
  // MarkdownEditor 必须放在 flex 容器内（实际放在 section 的 flex 流里）
  assertStringIncludes(src, "<MarkdownEditor");
});