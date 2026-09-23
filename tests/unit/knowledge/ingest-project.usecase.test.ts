/**
 * IngestProjectUseCase 单元测试
 *
 * 覆盖：
 *   - 项目无消息 → scanned=0, indexed=0
 *   - 1 条 user + 1 条 assistant → 2 items, ≥2 chunks
 *   - 已采纳消息（findBySourceMessage 命中）→ skipped
 *   - 多次 ingest 幂等：第二次 skipped=前次 indexed
 *   - embed 失败 → error 入 errors[]，其他不阻塞
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { IngestProjectUseCase } from "@backend/application/knowledge/ingest-project.usecase.ts";
import { MockEmbeddingProvider } from "@backend/ai/embedding/mock-embedding.provider.ts";
import { AiSession } from "@backend/domain/ai-session/ai-session.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { ProjectId } from "@shared/types/ids.ts";

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

async function createProject(db: Database, name = "ingest-test"): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name, clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  return r.value.id;
}

/** 把项目绑定到一个 session 并写若干 user/assistant 消息（绕开 LLM） */
async function seedMessages(
  db: Database,
  pid: ProjectId,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  const sessionRepo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const r = AiSession.create({ projectId: pid, subAgentName: "test", title: "seed", clock });
  assert(r.ok);
  if (!r.ok) throw new Error("session");
  const session = r.value;
  for (const m of messages) {
    const mr = session.appendMessage({ role: m.role, content: m.content }, clock);
    assert(mr.ok);
    if (!mr.ok) throw new Error("msg");
    clock.advance(1000);
  }
  const saveR = await sessionRepo.save(session);
  assert(saveR.ok);
}

Deno.test("IngestProject —— 项目无消息 → scanned=0, indexed=0", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  const uc = new IngestProjectUseCase({
    sessionRepo: new SqliteAiSessionRepository(db),
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const r = await uc.execute({ projectId: pid, clock: new FixedClock(new Date()) });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.scanned, 0);
  assertEquals(r.value.indexed, 0);
  assertEquals(r.value.totalChunks, 0);
});

Deno.test("IngestProject —— 2 条消息 → 2 items, ≥2 chunks", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  await seedMessages(db, pid, [
    { role: "user", content: "客户反馈响应慢" },
    { role: "assistant", content: "已记录痛点：响应慢 + 报表生成慢 + 跨系统集成困难。这是初步诊断。" },
  ]);
  const uc = new IngestProjectUseCase({
    sessionRepo: new SqliteAiSessionRepository(db),
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const r = await uc.execute({ projectId: pid, clock: new FixedClock(new Date()) });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.scanned, 2);
  assertEquals(r.value.indexed, 2);
  assert(r.value.totalChunks >= 2, `expected ≥2 chunks, got ${r.value.totalChunks}`);
});

Deno.test("IngestProject —— 二次 ingest 幂等：已采纳消息跳过", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  await seedMessages(db, pid, [
    { role: "user", content: "现状：客户希望优化系统响应" },
    { role: "assistant", content: "建议：分阶段实施，先优化数据库后端再升级前端框架" },
  ]);
  const uc = new IngestProjectUseCase({
    sessionRepo: new SqliteAiSessionRepository(db),
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const r1 = await uc.execute({ projectId: pid, clock: new FixedClock(new Date()) });
  assert(r1.ok);
  if (!r1.ok) return;
  assertEquals(r1.value.indexed, 2);

  const r2 = await uc.execute({ projectId: pid, clock: new FixedClock(new Date()) });
  assert(r2.ok);
  if (!r2.ok) return;
  assertEquals(r2.value.scanned, 2);
  assertEquals(r2.value.indexed, 0);
  assertEquals(r2.value.skipped, 2);
  // duplicate_source 是跳过原因
  assert(r2.value.items.every((it) => it.skippedReason === "duplicate_source"));
});

Deno.test("IngestProject —— 空内容消息被 SQL 层过滤（scanned 只算非空）", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  await seedMessages(db, pid, [
    { role: "user", content: "" },
    { role: "assistant", content: "有内容" },
  ]);
  const uc = new IngestProjectUseCase({
    sessionRepo: new SqliteAiSessionRepository(db),
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const r = await uc.execute({ projectId: pid, clock: new FixedClock(new Date()) });
  assert(r.ok);
  if (!r.ok) return;
  // 空内容消息在 listMessagesByProject 的 SQL 层 length(content)>0 直接过滤掉，
  // use case 内部的 no_content 兜底主要防御未来 schema 变化 / 直插 DB 的脏数据。
  assertEquals(r.value.scanned, 1);
  assertEquals(r.value.indexed, 1);
  assertEquals(r.value.skipped, 0);
});

Deno.test("IngestProject —— embed 失败一条不影响其他", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  await seedMessages(db, pid, [
    { role: "user", content: "msg1" },
    { role: "assistant", content: "msg2" },
  ]);

  // 构造一个会失败一次的 embedding provider：第一次返回空数组（让 count mismatch）
  let call = 0;
  const flaky = {
    providerName: "flaky",
    modelId: "flaky-v1",
    dimension: 4,
    async embed(_texts: readonly string[]): Promise<Float32Array[]> {
      call++;
      if (call === 1) return []; // 空数组 → mismatch
      return [new Float32Array([0.1, 0.2, 0.3, 0.4])];
    },
  };

  const uc = new IngestProjectUseCase({
    sessionRepo: new SqliteAiSessionRepository(db),
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    embeddingProvider: flaky,
  });
  const r = await uc.execute({ projectId: pid, clock: new FixedClock(new Date()) });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.scanned, 2);
  // 第一条 ingest 失败（embedding count=0 vs chunks=1）→ skipped；第二条成功
  assertEquals(r.value.indexed, 1);
  assertEquals(r.value.skipped, 1);
  assertEquals(r.value.errors.length, 1);
});