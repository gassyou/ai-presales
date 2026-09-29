/**
 * 任务 15（阶段 13 / PR #6）：Composer 改造 —— 静态断言
 *
 * 覆盖：
 *   - ChatComposer.vue 不再 import / 引用 SubAgentPicker
 *   - ChatComposer.vue 不再有"工具 / 纯聊"切换按钮
 *   - ChatComposer.vue 用 llm-profiles store 作 profile 数据源
 *   - llm-profiles.store.ts 存在并提供 LlmProfile shape
 *   - DTO 适配函数 toLlmProfile 把 name → id，缺 label 时用 provider/model
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test({
  name: "t15 — ChatComposer 不再 import SubAgentPicker",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/ai-chat/ChatComposer.vue",
    );
    assertEquals(
      text.includes("SubAgentPicker"),
      false,
      "ChatComposer.vue 不应再引用 SubAgentPicker",
    );
    assertEquals(
      text.includes("@frontend/features/sub-agent/SubAgentPicker"),
      false,
    );
  },
});

Deno.test({
  name: "t15 — ChatComposer 不再有「工具 / 纯聊」切换按钮",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/ai-chat/ChatComposer.vue",
    );
    // 检查不出现工具/纯聊相关的图标类名（Tools / ChatDotRound 是 Element Plus 的对应组件）
    assertEquals(text.includes("Tools"), false);
    assertEquals(text.includes("ChatDotRound"), false);
    // toolsEnabled 也应在 Composer 不再被引用（默认 agent 模式）
    assertEquals(text.includes("toolsEnabled"), false);
  },
});

Deno.test({
  name: "t15 — ChatComposer 用 llm-profiles store 作 profile 数据源",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/ai-chat/ChatComposer.vue",
    );
    assertStringIncludes(
      text,
      "useLlmProfilesStore",
    );
    assertStringIncludes(
      text,
      'from "@frontend/features/settings/stores/llm-profiles.store.ts"',
    );
    assertStringIncludes(text, "llmStore.items");
  },
});

Deno.test({
  name:
    "t15 — llm-profiles.store.ts 存在并导出 useLlmProfilesStore + LlmProfile shape",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/settings/stores/llm-profiles.store.ts",
    );
    assertStringIncludes(text, "defineStore");
    assertStringIncludes(text, "useLlmProfilesStore");
    assertStringIncludes(text, "interface LlmProfile");
    assertStringIncludes(text, "id:");
    assertStringIncludes(text, "label:");
    assertStringIncludes(text, "model:");
    assertStringIncludes(text, "load(");
    assertStringIncludes(text, "settingsApi.getLLMProfiles");
  },
});

Deno.test({
  name:
    "t15 — toLlmProfile 适配：name→id，缺 label 时 fallback `${provider}/${model}`",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // 用静态源码断言：toLlmProfile 应做"name → id" + label fallback；
    // 运行时 import 会因 vue 不在 import map 失败（前端文件仅供 Vite 构建解析）。
    const text = await Deno.readTextFile(
      "frontend/src/features/settings/stores/llm-profiles.store.ts",
    );
    assertStringIncludes(text, "export function toLlmProfile");
    assertStringIncludes(text, "id: p.name");
    assertStringIncludes(text, "${p.provider}/${p.model}");
  },
});
