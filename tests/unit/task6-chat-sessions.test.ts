/**
 * 任务 6：AI chat 会话历史保存 —— 测试
 *
 * 覆盖：
 *   - chat_sessions / chat_messages 表已创建（migration 014）
 *   - SqliteChatSessionRepository：create / list / rename / delete / append / listMessages
 *   - ChatSessionUseCase：所有 CRUD + 校验
 *   - HTTP：POST / GET / PATCH / DELETE / list-messages / append-message
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
import { handleChatSession } from "@backend/presentation/routes/chat-session.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
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

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

function newClock(): FixedClock {
  return new FixedClock(new Date("2026-02-01T00:00:00Z"));
}

async function setupUseCase() {
  const db = await (async () => {
    const d = newDb();
    await d.ready();
    return d;
  })();
  const repo = new SqliteChatSessionRepository(db);
  const uc = new ChatSessionUseCase({ repo, clock: newClock() });
  return { uc, repo, db };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `00000000-0000-0000-0000-${counter.toString().padStart(12, "0")}`;
}

async function setupWithIdGen() {
  const db = newDb();
  await db.ready();
  const repo = new SqliteChatSessionRepository(db);
  const uc = new ChatSessionUseCase({ repo, clock: newClock(), idGen: nextId });
  return { uc, repo, db };
}

// ====== Migration ======

Deno.test("t6 — migration 014 创建 chat_sessions + chat_messages 表", async () => {
  const db = newDb();
  await db.ready();
  // 简单 sanity：能插入和查
  db.run(
    `INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
     VALUES ('id1', NULL, 'test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  );
  const row = db.queryRow<{ id: string; title: string }>(
    `SELECT id, title FROM chat_sessions WHERE id='id1'`,
  );
  assertEquals(row?.id, "id1");
  assertEquals(row?.title, "test");
});

// ====== Repository ======

Deno.test("t6 — SqliteChatSessionRepository 创建 + 列表", async () => {
  const { ChatSession } = await import("@backend/domain/chat-session/chat-session.ts");
  const db = newDb();
  await db.ready();
  const repo = new SqliteChatSessionRepository(db);
  const cs = ChatSession.create({
    id: "s1",
    projectId: "p1" as never,
    title: "first",
    now: new Date("2026-01-01T00:00:00Z"),
  });
  assert(cs.ok);
  if (!cs.ok) return;
  repo.createSession(cs.value);

  const list = repo.listAllSessions();
  assertEquals(list.length, 1);
  assertEquals(list[0].title, "first");
});

Deno.test("t6 — appendMessage 自动 touch session.updated_at", async () => {
  const { uc } = await setupWithIdGen();
  const csR = uc.createSession({ projectId: null, title: "x" });
  assert(csR.ok);
  if (!csR.ok) return;
  // 初始 updatedAt = clock.now() = 2026-02-01T00:00:00Z
  assertEquals(csR.value.updatedAt.toISOString(), "2026-02-01T00:00:00.000Z");
  // 推一条消息
  const mR = uc.appendMessage({ sessionId: csR.value.id, role: "user", content: "hi" });
  assert(mR.ok);
  if (!mR.ok) return;
  // session.updated_at 同步到 createdAt
  const refresh = uc.getSession(csR.value.id);
  assert(refresh.ok);
  if (!refresh.ok) return;
  assertEquals(refresh.value.updatedAt.toISOString(), "2026-02-01T00:00:00.000Z");
});

Deno.test("t6 — listMessages 按 created_at 升序", async () => {
  const { uc } = await setupWithIdGen();
  const csR = uc.createSession({ projectId: null, title: "t" });
  assert(csR.ok);
  if (!csR.ok) return;
  // 3 条 user → 1 条 assistant
  uc.appendMessage({ sessionId: csR.value.id, role: "user", content: "q1" });
  uc.appendMessage({ sessionId: csR.value.id, role: "assistant", content: "a1" });
  uc.appendMessage({ sessionId: csR.value.id, role: "user", content: "q2" });
  const r = uc.listMessages(csR.value.id);
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.length, 3);
  assertEquals(r.value[0].content, "q1");
  assertEquals(r.value[1].content, "a1");
  assertEquals(r.value[2].content, "q2");
});

Deno.test("t6 — listSessionsByProject 仅返回指定项目；null 仅返回全局", async () => {
  const { uc } = await setupWithIdGen();
  const a = uc.createSession({ projectId: "A" as never, title: "a" });
  const b = uc.createSession({ projectId: "B" as never, title: "b" });
  const c = uc.createSession({ projectId: null, title: "c" });
  assert(a.ok && b.ok && c.ok);
  if (!a.ok || !b.ok || !c.ok) return;

  assertEquals(uc.listSessionsByProject("A" as never).length, 1);
  assertEquals(uc.listSessionsByProject("B" as never).length, 1);
  assertEquals(uc.listSessionsByProject(null).length, 1);
  assertEquals(uc.listAllSessions().length, 3);
});

Deno.test("t6 — renameSession 不存在 → NOT_FOUND；空标题也 NOT_FOUND（仓库 trim 拒绝）", async () => {
  const { uc } = await setupWithIdGen();
  const r1 = uc.renameSession("ghost", "new");
  assertFalse(r1.ok);
  if (r1.ok) return;
  assertEquals(r1.error.code, "NOT_FOUND");

  const csR = uc.createSession({ projectId: null, title: "old" });
  assert(csR.ok);
  if (!csR.ok) return;
  // 仓库 renameSession trim 后空字符串 → 返回 false → useCase 返 NOT_FOUND
  const r2 = uc.renameSession(csR.value.id, "   ");
  assertFalse(r2.ok);
  if (r2.ok) return;
  assertEquals(r2.error.code, "NOT_FOUND");
});

Deno.test("t6 — deleteSession 删 sessions；FK CASCADE 删 messages", async () => {
  const { uc } = await setupWithIdGen();
  const csR = uc.createSession({ projectId: null, title: "x" });
  assert(csR.ok);
  if (!csR.ok) return;
  uc.appendMessage({ sessionId: csR.value.id, role: "user", content: "q" });
  uc.appendMessage({ sessionId: csR.value.id, role: "user", content: "q2" });

  const delR = uc.deleteSession(csR.value.id);
  assert(delR.ok);
  if (!delR.ok) return;

  // session 没了
  const get = uc.getSession(csR.value.id);
  assertFalse(get.ok);

  // messages 也连带没了
  const lR = uc.listMessages(csR.value.id);
  assertFalse(lR.ok);
  assertEquals(lR.error.code, "NOT_FOUND");
});

// ====== HTTP routes ======

async function setupHttpRoute() {
  const db = newDb();
  await db.ready();
  const repo = new SqliteChatSessionRepository(db);
  const uc = new ChatSessionUseCase({ repo, clock: newClock(), idGen: nextId });
  const deps = {
    useCase: uc,
    logger: makeLogger(),
  };
  return {
    deps,
    call: (req: Request) => handleChatSession(req, deps, new URL(req.url)),
  };
}

Deno.test("t6 — HTTP POST 创建 session 返 201", async () => {
  const { call } = await setupHttpRoute();
  const res = await call(
    new Request("http://localhost/api/chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "test session" }),
    }),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assert(body.id);
  assertEquals(body.title, "test session");
});

Deno.test("t6 — HTTP POST 空 title → 400", async () => {
  const { call } = await setupHttpRoute();
  const res = await call(
    new Request("http://localhost/api/chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test("t6 — HTTP GET list sessions 支持 ?projectId=", async () => {
  const { call, deps } = await setupHttpRoute();
  // 准备数据
  deps.useCase.createSession({ projectId: "P1" as never, title: "a" });
  deps.useCase.createSession({ projectId: null, title: "b" });

  const r1 = await call(
    new Request("http://localhost/api/chat/sessions", { method: "GET" }),
  );
  assertEquals(r1.status, 200);
  const b1 = await r1.json();
  assertEquals(b1.items.length, 2);

  const r2 = await call(
    new Request("http://localhost/api/chat/sessions?projectId=P1", { method: "GET" }),
  );
  const b2 = await r2.json();
  assertEquals(b2.items.length, 1);
  assertEquals(b2.items[0].title, "a");
});

Deno.test("t6 — HTTP GET/PATCH/DELETE /:id", async () => {
  const { call, deps } = await setupHttpRoute();
  const csR = deps.useCase.createSession({ projectId: null, title: "x" });
  assert(csR.ok);
  if (!csR.ok) return;
  const id = csR.value.id;

  // GET
  const g = await call(new Request(`http://localhost/api/chat/sessions/${id}`, { method: "GET" }));
  assertEquals(g.status, 200);
  // PATCH
  const p = await call(new Request(`http://localhost/api/chat/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "renamed" }),
  }));
  assertEquals(p.status, 200);
  // DELETE
  const d = await call(new Request(`http://localhost/api/chat/sessions/${id}`, { method: "DELETE" }));
  assertEquals(d.status, 204);
  // DELETE again → 404
  const d2 = await call(new Request(`http://localhost/api/chat/sessions/${id}`, { method: "DELETE" }));
  assertEquals(d2.status, 404);
});

Deno.test("t6 — HTTP POST /:id/messages append + GET list messages", async () => {
  const { call, deps } = await setupHttpRoute();
  const csR = deps.useCase.createSession({ projectId: null, title: "x" });
  assert(csR.ok);
  if (!csR.ok) return;
  const id = csR.value.id;

  const p = await call(new Request(`http://localhost/api/chat/sessions/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "user", content: "hi" }),
  }));
  assertEquals(p.status, 201);
  const pb = await p.json();
  assertEquals(pb.content, "hi");
  assertEquals(pb.role, "user");

  const g = await call(new Request(`http://localhost/api/chat/sessions/${id}/messages`, { method: "GET" }));
  assertEquals(g.status, 200);
  const gb = await g.json();
  assertEquals(gb.items.length, 1);
  assertEquals(gb.items[0].content, "hi");
});

Deno.test("t6 — HTTP POST /:id/messages 不存在的 session → 404", async () => {
  const { call } = await setupHttpRoute();
  const res = await call(new Request(
    "http://localhost/api/chat/sessions/ghost-id/messages",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content: "x" }),
    },
  ));
  assertEquals(res.status, 404);
});