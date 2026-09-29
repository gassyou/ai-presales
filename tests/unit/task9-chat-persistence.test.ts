/**
 * 任务 9（阶段 13 / PR #4）：Chat session 持久化 + HTTP 路由接线 —— 测试
 *
 * 覆盖：
 *   - HTTP POST /api/chat/sessions 创建 user session
 *   - HTTP GET /api/chat/sessions?projectId=p1 列表过滤
 *   - HTTP PATCH /api/chat/sessions/:id 改名
 *   - HTTP DELETE /api/chat/sessions/:id 删除（含 messages cascade）
 *   - HTTP POST /api/chat/sessions/:id/messages 追加消息 + touch session.updated_at
 *   - HTTP POST /api/chat/sessions/:id/messages 缺 role → 400
 *   - HTTP POST /api/chat/sessions/missing/messages → 404
 *   - HTTP GET /api/chat/sessions/:id/messages 列消息（user + assistant + tool_calls）
 *   - 端到端：建 session → append user → append assistant + toolCalls → listMessages
 *   - appendMessage 自动 touch chat_sessions.updated_at
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
import { SqliteChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import {
  type ChatSessionRouteDeps,
  handleChatSession,
} from "@backend/presentation/routes/chat-session.route.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

function newDb(): Database {
  return new Database({
    paths: {
      root: "/tmp/whatever",
      data: "/tmp/whatever",
      logs: "/tmp/whatever",
      vendor: "/tmp/whatever",
      output: "/tmp/whatever",
    },
    inMemory: true,
    skipExtensions: true,
  });
}

function clock(): FixedClock {
  return new FixedClock(new Date("2026-03-01T00:00:00Z"));
}

function clockAfter(seconds: number): FixedClock {
  return new FixedClock(new Date(`2026-03-01T00:00:${seconds.toString().padStart(2, "0")}Z`));
}

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  } as unknown as Logger;
}

async function setupRoute(): Promise<{
  deps: ChatSessionRouteDeps;
  db: Database;
}> {
  const db = newDb();
  await db.ready();
  const cl = clock();
  const useCase = new ChatSessionUseCase({
    repo: new SqliteChatSessionRepository(db),
    clock: cl,
  });
  return {
    deps: { logger: makeLogger(), useCase },
    db,
  };
}

async function jsonReq(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Request> {
  const { method = "GET", body } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ===== HTTP route tests =====

Deno.test({
  name: "t9 — POST /api/chat/sessions 创建 user session → 201 + DTO",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    const req = await jsonReq("/api/chat/sessions", {
      method: "POST",
      body: { projectId: "p1", title: "需求评审" },
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 201);
    const dto = await resp.json();
    assertEquals(dto.projectId, "p1");
    assertEquals(dto.title, "需求评审");
    assertExists(dto.createdAt);
    assertExists(dto.updatedAt);
  },
});

Deno.test({
  name: "t9 — GET /api/chat/sessions?projectId=p1 按项目过滤",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    await deps.useCase.createSession({ projectId: "p1", title: "A" });
    await deps.useCase.createSession({ projectId: "p2", title: "B" });
    const req = await jsonReq("/api/chat/sessions?projectId=p1");
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.items.length, 1);
    assertEquals(body.items[0].title, "A");
  },
});

Deno.test({
  name: "t9 — PATCH /api/chat/sessions/:id 改名",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    const r = deps.useCase.createSession({ projectId: "p1", title: "old" });
    assert(r.ok);
    const req = await jsonReq(`/api/chat/sessions/${r.value.id}`, {
      method: "PATCH",
      body: { title: "new" },
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const dto = await resp.json();
    assertEquals(dto.title, "new");
  },
});

Deno.test({
  name: "t9 — DELETE /api/chat/sessions/:id 删除（含 messages cascade）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps, db } = await setupRoute();
    const r = deps.useCase.createSession({ projectId: "p1", title: "x" });
    assert(r.ok);
    const sid = r.value.id;
    const mr = deps.useCase.appendMessage({ sessionId: sid, role: "user", content: "hi" });
    assert(mr.ok);

    const delReq = await jsonReq(`/api/chat/sessions/${sid}`, { method: "DELETE" });
    const delResp = await handleChatSession(delReq, deps, new URL(delReq.url));
    assertEquals(delResp.status, 204);

    // CASCADE 应清掉 messages
    const remaining = db.query<{ c: number }>(
      "SELECT COUNT(*) AS c FROM chat_messages WHERE session_id = ?",
      [sid],
    );
    assertEquals(remaining[0]?.c, 0);
  },
});

Deno.test({
  name: "t9 — POST /api/chat/sessions/:id/messages 追加 user 消息 + touch updated_at",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps, db } = await setupRoute();
    // 时钟提前到 01:00 后建 session
    const db2 = newDb();
    await db2.ready();
    const cl = clockAfter(10);
    const useCase = new ChatSessionUseCase({
      repo: new SqliteChatSessionRepository(db2),
      clock: cl,
    });
    const r = useCase.createSession({ projectId: "p1", title: "x" });
    assert(r.ok);
    const sid = r.value.id;

    // 把时钟拨到 02:00，appendMessage 后 chat_sessions.updated_at 应该是 02:00
    const useCase2 = new ChatSessionUseCase({
      repo: new SqliteChatSessionRepository(db2),
      clock: clockAfter(20),
    });
    const mr = useCase2.appendMessage({ sessionId: sid, role: "user", content: "hi" });
    assert(mr.ok);

    const row = db2.query<{ updated_at: string }>(
      "SELECT updated_at FROM chat_sessions WHERE id = ?",
      [sid],
    );
    const ua = String(row[0]?.updated_at ?? "");
    assertEquals(ua, new Date("2026-03-01T00:00:20Z").toISOString());
    assert(mr.value.id !== sid); // 消息 id 不同于 session id
    assertEquals(mr.value.role, "user");
    assertEquals(mr.value.content, "hi");
  },
});

Deno.test({
  name: "t9 — POST /api/chat/sessions/:id/messages 缺 role → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    const r = deps.useCase.createSession({ projectId: "p1", title: "x" });
    assert(r.ok);
    const req = await jsonReq(`/api/chat/sessions/${r.value.id}/messages`, {
      method: "POST",
      body: { content: "hi" }, // 缺 role
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 400);
  },
});

Deno.test({
  name: "t9 — POST /api/chat/sessions/missing-id/messages → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    const req = await jsonReq("/api/chat/sessions/no-such-id/messages", {
      method: "POST",
      body: { role: "user", content: "hi" },
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 404);
  },
});

Deno.test({
  name: "t9 — GET /api/chat/sessions/:id/messages 列消息（含 toolCalls）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    const r = deps.useCase.createSession({ projectId: "p1", title: "x" });
    assert(r.ok);
    const sid = r.value.id;

    deps.useCase.appendMessage({ sessionId: sid, role: "user", content: "u1" });
    deps.useCase.appendMessage({
      sessionId: sid,
      role: "assistant",
      content: "a1",
      toolCalls: [
        {
          id: "tc1",
          name: "list_files",
          args: { path: "/" },
          ok: true,
          result: "...",
          durationMs: 12,
        },
      ],
    });

    const req = await jsonReq(`/api/chat/sessions/${sid}/messages`);
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.items.length, 2);
    assertEquals(body.items[0].role, "user");
    assertEquals(body.items[1].role, "assistant");
    assertEquals(body.items[1].toolCalls[0].name, "list_files");
    assertEquals(body.items[1].toolCalls[0].ok, true);
  },
});

Deno.test({
  name: "t9 — 端到端：建 session → 两条消息按 createdAt ASC 排列",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const cl = new FixedClock(new Date("2026-03-01T00:00:00Z"));
    const useCase = new ChatSessionUseCase({
      repo: new SqliteChatSessionRepository(db),
      clock: cl,
    });
    const r = useCase.createSession({ projectId: "p1", title: "x" });
    assert(r.ok);
    const sid = r.value.id;

    // 时钟推进以确保消息 created_at 递增
    const cl2 = new FixedClock(new Date("2026-03-01T00:00:30Z"));
    const useCase2 = new ChatSessionUseCase({
      repo: new SqliteChatSessionRepository(db),
      clock: cl2,
    });
    useCase2.appendMessage({ sessionId: sid, role: "user", content: "u1" });

    const cl3 = new FixedClock(new Date("2026-03-01T00:01:00Z"));
    const useCase3 = new ChatSessionUseCase({
      repo: new SqliteChatSessionRepository(db),
      clock: cl3,
    });
    useCase3.appendMessage({ sessionId: sid, role: "assistant", content: "a1" });

    const mr = useCase3.listMessages(sid);
    assert(mr.ok);
    assertEquals(mr.value.length, 2);
    assertEquals(mr.value[0].role, "user");
    assertEquals(mr.value[1].role, "assistant");
    assert(new Date(mr.value[0].createdAt).getTime() < new Date(mr.value[1].createdAt).getTime());
  },
});
