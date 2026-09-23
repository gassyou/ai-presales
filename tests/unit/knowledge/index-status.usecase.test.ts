/**
 * IndexStatusUseCase 单元测试
 *
 * 覆盖：
 *   - 空项目 → isIndexed=false, chunkCount=0
 *   - 已入库 → isIndexed=true, chunkCount>0, lastIngestedAt 非空
 *   - 项目无 message → messageCount=0
 *   - 有 message 但未入库 → isIndexed=false, messageCount>0
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { IndexStatusUseCase } from "@backend/application/knowledge/index-status.usecase.ts";
import { KnowledgeItem } from "@backend/domain/knowledge/knowledge-item.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";
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

async function createProject(db: Database): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "idx-test", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  return r.value.id;
}

function makeEmbedding(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.1);
  return v;
}

Deno.test("IndexStatus —— 空项目：isIndexed=false, 0 chunks", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  const uc = new IndexStatusUseCase({
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    sessionRepo: new SqliteAiSessionRepository(db),
  });
  const r = await uc.execute({ projectId: pid });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.isIndexed, false);
  assertEquals(r.value.chunkCount, 0);
  assertEquals(r.value.messageCount, 0);
  assertEquals(r.value.lastIngestedAt, null);
});

Deno.test("IndexStatus —— 已入库：isIndexed=true + lastIngestedAt 非空", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));

  // 建一个 knowledge item + 1 chunk
  const itemR = KnowledgeItem.create({
    projectId: pid,
    title: "t",
    body: "b",
    adoptionKind: "manual",
    clock,
  });
  assert(itemR.ok);
  if (!itemR.ok) return;
  await knowledgeRepo.save(itemR.value);

  const cR = KnowledgeChunk.create({
    knowledgeId: itemR.value.id,
    projectId: pid,
    sourceKind: "message",
    ordinal: 0,
    chunkText: "一段文本",
    tokenCount: 5,
    embeddingModel: "mock",
    embeddingDim: 4,
    embedding: makeEmbedding(4, 0),
  });
  assert(cR.ok);
  if (!cR.ok) return;
  await chunkRepo.saveChunks([cR.value]);

  const uc = new IndexStatusUseCase({
    knowledgeRepo,
    chunkRepo,
    sessionRepo: new SqliteAiSessionRepository(db),
  });
  const r = await uc.execute({ projectId: pid });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.isIndexed, true);
  assertEquals(r.value.chunkCount, 1);
  assertEquals(r.value.knowledgeItemCount, 1);
  assert(r.value.lastIngestedAt !== null);
});

Deno.test("IndexStatus —— 有 message 但未入库 → messageCount>0, isIndexed=false", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createProject(db);
  const sessionRepo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const sR = AiSession.create({ projectId: pid, subAgentName: "x", title: "x", clock });
  assert(sR.ok);
  if (!sR.ok) return;
  const s = sR.value;
  s.appendMessage({ role: "user", content: "一个用户问题" }, clock);
  s.appendMessage({ role: "assistant", content: "一个助手回答" }, clock);
  await sessionRepo.save(s);

  const uc = new IndexStatusUseCase({
    knowledgeRepo: new SqliteKnowledgeRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    sessionRepo,
  });
  const r = await uc.execute({ projectId: pid });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.messageCount, 2);
  assertEquals(r.value.isIndexed, false);
  assertEquals(r.value.chunkCount, 0);
});