/**
 * 任务 5：AI chat 新建会话 —— 测试
 *
 * 验证：
 *   - chatSessionApi：list / create / remove / listMessages 客户端结构
 *   - ai-chat.store 暴露：currentSessionId / sessions / loadSessions /
 *     createSessionForProject / switchToSession / deleteCurrentSession
 *
 * 静态分析（无 vue test infra）
 */

import { assert, assertStringIncludes } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = Deno.cwd();

function readText(rel: string): string {
  return Deno.readTextFileSync(join(projectRoot, rel));
}

// ====== chatSessionApi ======

Deno.test("t5 — chat-session.api.ts 文件存在并导出 chatSessionApi", () => {
  assert(
    existsSync(join(projectRoot, "frontend/src/features/ai-chat/api/chat-session.api.ts")),
    "chat-session.api.ts 必须存在",
  );
  const src = readText("frontend/src/features/ai-chat/api/chat-session.api.ts");
  assertStringIncludes(src, "export const chatSessionApi");
  assertStringIncludes(src, "list(");
  assertStringIncludes(src, "create(");
  assertStringIncludes(src, "remove(");
  assertStringIncludes(src, "listMessages(");
  assertStringIncludes(src, "rename(");
  assertStringIncludes(src, "appendMessage(");
});

Deno.test("t5 — chatSessionApi.list 接受可选 projectId", () => {
  const src = readText("frontend/src/features/ai-chat/api/chat-session.api.ts");
  assertStringIncludes(src, "async list(projectId: string | null)");
  assertStringIncludes(src, "projectId=${encodeURIComponent(projectId)}");
});

Deno.test("t5 — chatSessionApi.create 接 title + projectId", () => {
  const src = readText("frontend/src/features/ai-chat/api/chat-session.api.ts");
  assertStringIncludes(src, "async create(input: { projectId: string | null; title: string })");
});

// ====== store ======

Deno.test("t5 — store 暴露 currentSessionId + sessions refs", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  assertStringIncludes(src, "const currentSessionId = ref<string | null>(null)");
  assertStringIncludes(src, "const sessions = ref<");
});

Deno.test("t5 — store 暴露 loadSessions / createSessionForProject / switchToSession / deleteCurrentSession", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  assertStringIncludes(src, "async function loadSessions(");
  assertStringIncludes(src, "async function createSessionForProject(");
  assertStringIncludes(src, "async function switchToSession(");
  assertStringIncludes(src, "async function deleteCurrentSession(");
});

Deno.test("t5 — createSessionForProject 清空当前 messages（新会话起点）", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  // 在 createSessionForProject 体内找到 "messages.value = []"
  const idx = src.indexOf("async function createSessionForProject(");
  assert(idx >= 0);
  // 取后续 ~500 字符
  const body = src.slice(idx, idx + 500);
  assertStringIncludes(body, "messages.value = []");
});

Deno.test("t5 — switchToSession 加载消息并写入 store messages", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  const idx = src.indexOf("async function switchToSession(");
  assert(idx >= 0);
  const body = src.slice(idx, idx + 600);
  assertStringIncludes(body, "messages.value =");
  assertStringIncludes(body, "listMessages");
});

Deno.test("t5 — deleteCurrentSession 清空当前 session + 从列表移除", () => {
  const src = readText("frontend/src/features/ai-chat/stores/ai-chat.store.ts");
  const idx = src.indexOf("async function deleteCurrentSession(");
  assert(idx >= 0);
  const body = src.slice(idx, idx + 600);
  assertStringIncludes(body, "sessions.value = sessions.value.filter");
  assertStringIncludes(body, "currentSessionId.value = null");
});