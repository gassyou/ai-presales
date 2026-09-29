/**
 * 任务 9：AI chat @项目 mention —— 测试
 *
 * 验证：
 *   - store 暴露 loadMentionCandidates 方法
 *   - AiChatPanel mount 时调 loadMentionCandidates
 *   - loadMentionCandidates 调 projectApi.list 并把 items 喂给 store
 *   - mentionCandidates 已被 setMentionCandidates 维护
 *
 * 用静态文本扫描（项目无 vue test infra）。
 */

import { assert, assertStringIncludes } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = Deno.cwd();

function readText(rel: string): string {
  return Deno.readTextFileSync(join(projectRoot, rel));
}

// ====== AiChatPanel mount 触发 ======

Deno.test("t9 — AiChatPanel import onMounted from vue", () => {
  const src = readText("frontend/src/features/ai-chat/AiChatPanel.vue");
  assertStringIncludes(src, "import { nextTick, onMounted");
});

Deno.test("t9 — AiChatPanel onMounted 调 store.loadMentionCandidates", () => {
  const src = readText("frontend/src/features/ai-chat/AiChatPanel.vue");
  assertStringIncludes(src, "onMounted");
  assertStringIncludes(src, "store.loadMentionCandidates");
});

// ====== store API ======

Deno.test("t9 — store 暴露 loadMentionCandidates 方法", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  // 函数定义 + return 暴露
  assertStringIncludes(src, "async function loadMentionCandidates");
  assertStringIncludes(src, "loadMentionCandidates,");
});

Deno.test("t9 — loadMentionCandidates 调 projectApi.list 并用 setMentionCandidates 注入", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  // 函数体里引用 projectApi
  assertStringIncludes(src, "projectApi.list");
  assertStringIncludes(src, "setMentionCandidates(resp.items)");
});

// ====== MentionAutocomplete UI 仍存在（之前就实现过的 @mention 弹窗） ======

Deno.test("t9 — ChatComposer 仍然使用 MentionAutocomplete 组件", () => {
  const src = readText("frontend/src/features/ai-chat/ChatComposer.vue");
  const template = src.match(/<template>[\s\S]*?<\/template>/);
  assert(template);
  assertStringIncludes(template[0], "MentionAutocomplete");
});

Deno.test("t9 — MentionAutocomplete 组件文件仍存在", () => {
  assert(
    existsSync(join(projectRoot, "frontend/src/features/ai-chat/MentionAutocomplete.vue")),
    "MentionAutocomplete.vue 必须存在",
  );
});

// ====== mention UI 已存在 ======

Deno.test("t9 — ChatComposer 触发 mention 弹窗的 state + UI 都在", () => {
  // 阶段 9（任务 9）变更：候选列表现在由 AiChatPanel onMounted 装入 store；
  // ChatComposer 内部已经实现了完整 mention 状态机。
  const src = readText("frontend/src/features/ai-chat/ChatComposer.vue");
  assertStringIncludes(src, "mentionState");
  assertStringIncludes(src, "MentionAutocomplete");
});