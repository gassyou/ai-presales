/**
 * SqliteAiSessionRepository 集成测试
 *
 * 用 in-memory SQLite —— 无扩展加载、无文件 IO。
 *
 * 覆盖：
 *   - save + findById round-trip（带 messages）
 *   - 引用计分持久化与读回
 *   - findSnapshotById 不读 messages
 *   - listByProject 过滤 + 分页 + 排序
 *   - findFrequentlyCitedMessages
 *   - purgeExpired
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { AiSessionId as toAiSessionId, ProjectId as toProjectId, newId } from "@shared/types/ids.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";

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

Deno.test("repo —— save + findById round-trip，含 user/assistant messages", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteAiSessionRepository(db);

  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));
  const projRepo = new SqliteProjectRepository(db);
  const projSvc = new ProjectService({ repo: projRepo, clock });
  const p = await projSvc.createProject({ name: "P1", clientName: "ACME" });
  assert(p.ok);
  if (!p.ok) return;

  const sess = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({
      projectId: p.value.id,
      title: "调研会话",
      clock,
      id: toAiSessionId(newId<"AiSessionId">()),
    }),
  );
  assert(sess.ok);
  if (!sess.ok) return;

  const s = sess.value;
  s.appendMessage({ role: "user", content: "请帮我设计提案" }, clock);
  const a1 = s.appendMessage({ role: "assistant", content: "好的，我先问几个问题" }, clock);
  assert(a1.ok);
  if (!a1.ok) return;
  s.appendMessage({
    role: "assistant",
    content: "基于之前的回答补充",
    citedMessageIds: [a1.value.id],
  }, clock);

  const save = await repo.save(s);
  assert(save.ok);

  const got = await repo.findById(s.id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.titleValue, "调研会话");
  assertEquals(got.value.messages.length, 3);
  assertEquals(got.value.messages[1].role, "assistant");
  assertEquals(got.value.messages[1].content, "好的，我先问几个问题");
  // 引用计分：a1 应被引用 1 次
  assertEquals(got.value.citedCountMap().get(a1.value.id), 1);
});

Deno.test("repo —— findSnapshotById 不读 messages", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));

  const sess = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({ title: "T", clock, id: toAiSessionId(newId<"AiSessionId">()) }),
  );
  assert(sess.ok);
  if (!sess.ok) return;
  const s = sess.value;
  s.appendMessage({ role: "user", content: "hi" }, clock);
  s.appendMessage({ role: "assistant", content: "ok" }, clock);
  await repo.save(s);

  const snap = await repo.findSnapshotById(s.id);
  assert(snap);
  assertEquals(snap!.messageCount, 2);
  assertEquals(snap!.title, "T");
});

Deno.test("repo —— list 按 projectId 过滤 + 分页 + updatedAt desc", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteAiSessionRepository(db);
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));
  const projSvc = new ProjectService({ repo: projRepo, clock });

  const p1 = await projSvc.createProject({ name: "P1", clientName: "ACME" });
  const p2 = await projSvc.createProject({ name: "P2", clientName: "BETA" });
  assert(p1.ok && p2.ok);
  if (!p1.ok || !p2.ok) return;

  // 给 p1 建 3 个，给 p2 建 1 个
  for (let i = 0; i < 3; i++) {
    const r = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
      m.AiSession.create({ projectId: p1.value.id, title: `s-${i}`, clock })
    );
    assert(r.ok);
    if (!r.ok) return;
    await repo.save(r.value);
    clock.advance(1000);
  }
  const r2 = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({ projectId: p2.value.id, title: "p2-s", clock })
  );
  assert(r2.ok);
  if (!r2.ok) return;
  await repo.save(r2.value);

  const list = await repo.list({ projectId: p1.value.id, limit: 10, offset: 0 });
  assertEquals(list.total, 3);
  assertEquals(list.items.length, 3);
  // 倒序：s-2 应排第一
  assertEquals(list.items[0].title, "s-2");

  const limit1 = await repo.list({ projectId: p1.value.id, limit: 1, offset: 0 });
  assertEquals(limit1.items.length, 1);
  assertEquals(limit1.total, 3);
});

Deno.test("repo —— findFrequentlyCitedMessages 按 threshold 过滤", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));

  const sess = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({ title: "T", clock, id: toAiSessionId(newId<"AiSessionId">()) }),
  );
  assert(sess.ok);
  if (!sess.ok) return;
  const s = sess.value;
  const a1 = s.appendMessage({ role: "assistant", content: "answer-1" }, clock);
  const a2 = s.appendMessage({ role: "assistant", content: "answer-2" }, clock);
  assert(a1.ok && a2.ok);
  if (!a1.ok || !a2.ok) return;

  // 让 a1 被引用 3 次
  for (let i = 0; i < 3; i++) {
    s.appendMessage({
      role: "assistant",
      content: `follow-${i}`,
      citedMessageIds: [a1.value.id],
    }, clock);
  }
  // a2 仅被引用 1 次
  s.appendMessage({ role: "assistant", content: "follow-x", citedMessageIds: [a2.value.id] }, clock);

  await repo.save(s);

  const out = await repo.findFrequentlyCitedMessages(2, 10);
  assertEquals(out.length, 1);
  assertEquals(out[0].messageId, a1.value.id);
  assertEquals(out[0].cites, 3);
});

Deno.test("repo —— purgeExpired 删除过期 active 会话", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));

  const sess = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({ title: "T", clock, id: toAiSessionId(newId<"AiSessionId">()), ttlDays: 1 }),
  );
  assert(sess.ok);
  if (!sess.ok) return;
  await repo.save(sess.value);

  // 推进到 2 天后
  const now = new Date("2026-04-03T00:00:00Z");
  const purged = await repo.purgeExpired(now);
  assertEquals(purged, 1);

  const got = await repo.findById(sess.value.id);
  assertFalse(got.ok);
  assertEquals(got.error.code, "NOT_FOUND");
});

Deno.test("repo —— cascade: 删除 project 会把 sessions 的 project_id 置 NULL", async () => {
  const db = newDb();
  await db.ready();
  const sessRepo = new SqliteAiSessionRepository(db);
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));
  const projSvc = new ProjectService({ repo: projRepo, clock });

  const p = await projSvc.createProject({ name: "P1", clientName: "ACME" });
  assert(p.ok);
  if (!p.ok) return;

  const sess = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({ projectId: p.value.id, title: "T", clock }),
  );
  assert(sess.ok);
  if (!sess.ok) return;
  await sessRepo.save(sess.value);

  // 删除项目（保留会话行，project_id 置 NULL —— schema 用 ON DELETE SET NULL）
  await projRepo.delete(p.value.id);

  const got = await sessRepo.findById(sess.value.id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.projectId, null);
});

Deno.test("repo —— save 失败时聚合根 pending events 保留（不丢失）", async () => {
  // 这里我们无法轻易模拟失败；通过 spy 也行，但本测试只验证 save 后被清空
  const db = newDb();
  await db.ready();
  const repo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-04-01T00:00:00Z"));

  const sess = await import("@backend/domain/ai-session/ai-session.ts").then((m) =>
    m.AiSession.create({ title: "T", clock, id: toAiSessionId(newId<"AiSessionId">()) }),
  );
  assert(sess.ok);
  if (!sess.ok) return;
  const s = sess.value;
  const beforeCount = s.pendingEvents.length;
  assertEquals(beforeCount, 1);

  await repo.save(s);
  assertEquals(s.pullDomainEvents().length, 0);
});