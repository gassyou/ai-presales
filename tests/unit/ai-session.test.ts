/**
 * AiSession + AiMessage 聚合根单元测试
 *
 * 覆盖：
 *   - AiSession.create 校验 title / projectId 缺省 / TTL
 *   - AiMessage.create 校验 role / content / toolCalls
 *   - appendMessage 正常路径 + 状态机（completed/aborted 后禁写）
 *   - 引用计分：助手消息 citedMessageIds 自增
 *   - adopt 助手消息 → 事件
 *   - complete / abort 状态机
 *   - snapshot + rehydrate round-trip
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { newId, type ProjectId, AiSessionId as toAiSessionId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import { AiSession } from "@backend/domain/ai-session/ai-session.ts";
import { AiMessage, makeToolCallSnapshot } from "@backend/domain/ai-session/message.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";

const clock = () => new FixedClock(new Date("2026-03-10T08:00:00Z"));

function baseArgs() {
  return {
    id: toAiSessionId(newId<"AiSessionId">()),
    projectId: toProjectId(newId<"ProjectId">()) as ProjectId | null,
    title: "ERP 调研",
    clock: clock(),
  };
}

Deno.test("AiSession.create —— 合法输入 → active 状态 + expire_at = 30 天后", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  assertEquals(s.statusValue, "active");
  assertEquals(s.titleValue, "ERP 调研");
  assertEquals(s.messages.length, 0);
  assert(s.expireAtValue instanceof Date);
  const diff = s.expireAtValue!.getTime() - s.createdAtValue.getTime();
  assertEquals(diff, 30 * 86_400_000);
  const events = s.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "ai-session.created");
});

Deno.test("AiSession.create —— title 为空 / 超长 → INVALID_INPUT", () => {
  const a = AiSession.create({ ...baseArgs(), title: "   " });
  assertFalse(a.ok);
  assertEquals(a.error.code, "INVALID_INPUT");
  const b = AiSession.create({ ...baseArgs(), title: "x".repeat(201) });
  assertFalse(b.ok);
  assertEquals(b.error.code, "INVALID_INPUT");
});

Deno.test("AiSession.create —— 无 projectId（全局对话）合法", () => {
  const r = AiSession.create({ ...baseArgs(), projectId: null });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.projectId, null);
});

Deno.test("AiSession.appendMessage —— user 消息正常 + 事件", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.pullDomainEvents();
  const append = s.appendMessage({ role: "user", content: "请帮我设计" }, clock());
  assert(append.ok);
  if (!append.ok) return;
  assertEquals(s.messages.length, 1);
  assertEquals(s.messages[0].role, "user");
  const events = s.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "ai-session.message-added");
});

Deno.test("AiSession.appendMessage —— assistant 消息 citedMessageIds 自增", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  // 先放一条 user + 一条 assistant（无引用）
  s.appendMessage({ role: "user", content: "你好" }, clock());
  const a1 = s.appendMessage({ role: "assistant", content: "有什么可以帮您？" }, clock());
  assert(a1.ok);
  if (!a1.ok) return;
  const targetMsgId = a1.value.id;

  s.pullDomainEvents();
  // 再放一条 assistant，引用 target
  const a2 = s.appendMessage({
    role: "assistant",
    content: "基于之前的回答",
    citedMessageIds: [targetMsgId],
  }, clock());

  const cites = s.citedCountMap();
  assertEquals(cites.get(targetMsgId), 1);
  assert(a2.ok);
});

Deno.test("AiSession.appendMessage —— completed / aborted 状态下拒绝", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  const c1 = clock();
  c1.advance(1000);
  assert(s.complete(c1).ok);
  s.pullDomainEvents();

  const a = s.appendMessage({ role: "user", content: "x" }, clock());
  assertFalse(a.ok);
  assertEquals(a.error.code, "ILLEGAL_STATE_TRANSITION");
});

Deno.test("AiSession.appendMessage —— assistant 既无 content 又无 toolCalls → INVALID_INPUT", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  const a = s.appendMessage({ role: "assistant", content: "" }, clock());
  assertFalse(a.ok);
  assertEquals(a.error.code, "INVALID_INPUT");
});

Deno.test("AiSession.appendMessage —— tool role 携带 tool result 合法", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  // 先放 assistant 触发 tool_use（这里用纯 content；toolCalls 由上层组合）
  s.appendMessage({
    role: "assistant",
    content: "我来读取文件",
    toolCalls: [makeToolCallSnapshot({ name: "read_file", args: { path: "x" }, ok: true, durationMs: 5 })],
  }, clock());
  const toolMsg = s.appendMessage({
    role: "tool",
    content: "文件内容",
    toolCalls: [makeToolCallSnapshot({ name: "read_file", args: { path: "x" }, result: "x 内容", ok: true, durationMs: 5 })],
  }, clock());
  assert(toolMsg.ok);
  assertEquals(s.messages.length, 2);
});

Deno.test("AiSession.appendMessage —— user 消息携带 toolCalls → INVALID_INPUT", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  const a = s.appendMessage({
    role: "user",
    content: "hi",
    toolCalls: [makeToolCallSnapshot({ name: "x", args: {}, ok: true, durationMs: 1 })],
  }, clock());
  assertFalse(a.ok);
  assertEquals(a.error.code, "INVALID_INPUT");
});

Deno.test("AiSession.adopt —— 采纳助手消息 → 事件", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.appendMessage({ role: "assistant", content: "提案概要：…" }, clock());
  s.pullDomainEvents();
  const msgId = s.messages[0].id;
  const ad = s.adopt(msgId, clock());
  assert(ad.ok);
  const events = s.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "ai-session.message-adopted");
});

Deno.test("AiSession.adopt —— 采纳非 assistant → INVALID_INPUT", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.appendMessage({ role: "user", content: "你好" }, clock());
  const ad = s.adopt(s.messages[0].id, clock());
  assertFalse(ad.ok);
  assertEquals(ad.error.code, "INVALID_INPUT");
});

Deno.test("AiSession.adopt —— 不存在的 messageId → NOT_FOUND", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  const ad = s.adopt(newId<"MessageId">(), clock());
  assertFalse(ad.ok);
  assertEquals(ad.error.code, "NOT_FOUND");
});

Deno.test("AiSession.complete —— active → completed，事件", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.pullDomainEvents();
  assert(s.complete(clock()).ok);
  assertEquals(s.statusValue, "completed");
  const events = s.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "ai-session.completed");
});

Deno.test("AiSession.complete —— completed 状态再 complete → ILLEGAL", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.complete(clock());
  const r2 = s.complete(clock());
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "ILLEGAL_STATE_TRANSITION");
});

Deno.test("AiSession.abort —— active → aborted + reason 写入事件", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.pullDomainEvents();
  assert(s.abort("user clicked stop", clock()).ok);
  assertEquals(s.statusValue, "aborted");
  const events = s.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "ai-session.aborted");
  const json = events[0].toJSON();
  assertEquals(json.reason, "user clicked stop");
});

Deno.test("AiSession.rehydrate —— round-trip 字段一致，无事件", () => {
  const r = AiSession.create(baseArgs());
  assert(r.ok);
  if (!r.ok) return;
  const s = r.value;
  s.appendMessage({ role: "user", content: "x" }, clock());
  const snap = s.snapshot();
  const messages = s.messageSnapshots();
  const cites = s.citedCountMap();
  const s2 = AiSession.rehydrate({
    id: snap.id,
    projectId: snap.projectId,
    subAgentName: snap.subAgentName,
    title: snap.title,
    status: snap.status,
    messages,
    citedCount: cites,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    expireAt: snap.expireAt,
  });
  assertEquals(s2.id, s.id);
  assertEquals(s2.titleValue, s.titleValue);
  assertEquals(s2.messages.length, 1);
  assertEquals(s2.pullDomainEvents().length, 0);
});

Deno.test("AiMessage.create —— 输入 token 负数 → INVALID_INPUT", () => {
  const r = AiMessage.create({
    role: "assistant",
    content: "hi",
    inputTokens: -1,
  });
  assertFalse(r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("AiMessage.create —— 超长 content → INVALID_INPUT", () => {
  const r = AiMessage.create({
    role: "assistant",
    content: "x".repeat(200_001),
  });
  assertFalse(r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("AiMessage.create —— sessionId 为空串 → INVALID_INPUT", () => {
  const r = AiMessage.create({
    sessionId: "   ",
    role: "assistant",
    content: "hi",
  });
  assertFalse(r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});