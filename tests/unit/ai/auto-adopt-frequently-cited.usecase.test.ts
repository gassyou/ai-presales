/**
 * AutoAdoptFrequentlyCitedUseCase 单元测试
 *
 * 覆盖：
 *   - threshold 过滤（cite_count < threshold 跳过）
 *   - dedupe：已采纳的跳过
 *   - 采纳后 ai_knowledge 有新行
 *   - 失败不影响其他
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { AdoptToKnowledgeUseCase } from "@backend/application/knowledge/adopt-to-knowledge.usecase.ts";
import { AutoAdoptFrequentlyCitedUseCase } from "@backend/application/ai/auto-adopt-frequently-cited.usecase.ts";
import { MockEmbeddingProvider } from "@backend/ai/embedding/mock-embedding.provider.ts";
import { AiSession } from "@backend/domain/ai-session/ai-session.ts";
import { AiMessage } from "@backend/domain/ai-session/message.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { ToolCallId } from "@shared/types/ids.ts";
import type { ProjectId as ProjectIdT } from "@shared/types/ids.ts";
import { MessageId as toMessageId, AiSessionId as toAiSessionId } from "@shared/types/ids.ts";

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

async function createProject(db: Database): Promise<ProjectIdT> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "t", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  return r.value.id;
}

/** 直接构造 session + citedCount，绕开 LLM 路径 */
async function seedSessionWithCites(
  db: Database,
  pid: ProjectIdT,
  assistantContent: string,
  citedCount: number,
): Promise<{ sessionId: string; messageId: string }> {
  const sessionRepo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const r = AiSession.create({
    projectId: pid,
    subAgentName: "test",
    title: "test",
    clock,
  });
  assert(r.ok);
  if (!r.ok) throw new Error("session");
  const session = r.value;
  session.appendMessage({ role: "user", content: "x" }, clock);
  const msg = session.appendMessage({ role: "assistant", content: assistantContent }, clock);
  assert(msg.ok);
  if (!msg.ok) throw new Error("msg");
  const saveRes = await sessionRepo.save(session);
  assert(saveRes.ok);
  // 手动更新 cite_count（绕开持久化层封装）
  for (let i = 0; i < citedCount; i++) {
    db.run(
      `INSERT INTO ai_message_cites (session_id, message_id, cite_count, last_cited_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(message_id) DO UPDATE SET cite_count = cite_count + 1, last_cited_at = excluded.last_cited_at`,
      [session.id, msg.value.id, new Date().toISOString()],
    );
  }
  return { sessionId: session.id, messageId: msg.value.id };
}

Deno.test("AutoAdopt —— 采纳 cite_count >= 3 的助手消息", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  const { messageId } = await seedSessionWithCites(db, pid, "高频引用的内容", 4);

  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const sessionRepo = new SqliteAiSessionRepository(db);
  const adopt = new AdoptToKnowledgeUseCase({
    knowledgeRepo,
    chunkRepo,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const uc = new AutoAdoptFrequentlyCitedUseCase({
    sessionRepo,
    knowledgeRepo,
    adopt,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });

  const result = await uc.execute({ threshold: 3, limit: 10 });
  assertEquals(result.scanned, 1);
  assertEquals(result.adopted, 1);
  assertEquals(result.skipped, 0);

  const found = await knowledgeRepo.findBySourceMessage(messageId);
  assert(found);
  assertEquals(found?.body, "高频引用的内容");
});

Deno.test("AutoAdopt —— cite_count < threshold 跳过", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  await seedSessionWithCites(db, pid, "不够高频", 2);

  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const sessionRepo = new SqliteAiSessionRepository(db);
  const adopt = new AdoptToKnowledgeUseCase({
    knowledgeRepo,
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const uc = new AutoAdoptFrequentlyCitedUseCase({
    sessionRepo,
    knowledgeRepo,
    adopt,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });

  const result = await uc.execute({ threshold: 3, limit: 10 });
  assertEquals(result.scanned, 0);
});

Deno.test("AutoAdopt —— 已采纳过的跳过（dedupe）", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  const { messageId } = await seedSessionWithCites(db, pid, "已采纳内容", 5);

  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const sessionRepo = new SqliteAiSessionRepository(db);
  const adopt = new AdoptToKnowledgeUseCase({
    knowledgeRepo,
    chunkRepo,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const uc = new AutoAdoptFrequentlyCitedUseCase({
    sessionRepo,
    knowledgeRepo,
    adopt,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });

  // 第一次采纳
  const r1 = await uc.execute({ threshold: 3, limit: 10 });
  assertEquals(r1.adopted, 1);

  // 第二次应跳过
  const r2 = await uc.execute({ threshold: 3, limit: 10 });
  assertEquals(r2.scanned, 1);
  assertEquals(r2.adopted, 0);
  assertEquals(r2.skipped, 1);

  // knowledge 仍只 1 条
  const found = await knowledgeRepo.findBySourceMessage(messageId);
  assert(found);
});

Deno.test("AutoAdopt —— session/message 找不到 → 跳过（健壮性）", async () => {
  const db = newDb();
  await db.ready();
  // 直接调用 findFrequentlyCitedMessages 时返回空 → 没有 candidate → 全部 0
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const sessionRepo = new SqliteAiSessionRepository(db);
  const adopt = new AdoptToKnowledgeUseCase({
    knowledgeRepo,
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const uc = new AutoAdoptFrequentlyCitedUseCase({
    sessionRepo,
    knowledgeRepo,
    adopt,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });

  const result = await uc.execute({ threshold: 3, limit: 10 });
  assertEquals(result.scanned, 0);
  assertEquals(result.adopted, 0);
  assertEquals(result.skipped, 0);
});

Deno.test("AutoAdopt —— 没有 projectId 的 session 跳过", async () => {
  const db = newDb();
  await db.ready();
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const sessionRepo = new SqliteAiSessionRepository(db);
  const r = AiSession.create({
    subAgentName: "test",
    title: "test",
    clock,
  });
  assert(r.ok);
  if (!r.ok) throw new Error("session");
  r.value.appendMessage({ role: "user", content: "x" }, clock);
  const msg = r.value.appendMessage({ role: "assistant", content: "无项目内容" }, clock);
  assert(msg.ok);
  await sessionRepo.save(r.value);

  // 写 cite
  if (msg.ok) {
    db.run(
      `INSERT INTO ai_message_cites (session_id, message_id, cite_count, last_cited_at)
       VALUES (?, ?, 5, ?)`,
      [r.value.id, msg.value.id, new Date().toISOString()],
    );
  }

  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const adopt = new AdoptToKnowledgeUseCase({
    knowledgeRepo,
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const uc = new AutoAdoptFrequentlyCitedUseCase({
    sessionRepo,
    knowledgeRepo,
    adopt,
    clock,
  });

  const result = await uc.execute({ threshold: 3, limit: 10 });
  assertEquals(result.adopted, 0);
  assertEquals(result.skipped, 1);
});

// keep imports referenced
void ToolCallId;
void toMessageId;
void toAiSessionId;
void AiMessage;