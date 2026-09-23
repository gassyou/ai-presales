/**
 * KnowledgeItem + AdoptToKnowledgeUseCase 单元测试
 *
 * 验证：
 *   - KnowledgeItem.create 校验
 *   - AdoptToKnowledgeUseCase 完整流程（含 chunk + embed + 持久化）
 *   - dedupe by sourceMessageId
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  AiSessionId as toAiSessionId,
  MessageId as toMessageId,
  ProjectId as toProjectId,
  newId,
} from "@shared/types/ids.ts";
import { KnowledgeItem } from "@backend/domain/knowledge/knowledge-item.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { AdoptToKnowledgeUseCase } from "@backend/application/knowledge/adopt-to-knowledge.usecase.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { MockEmbeddingProvider } from "@backend/ai/embedding/mock-embedding.provider.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { Database } from "@backend/persistence/database/database.ts";

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

async function createTestProject(db: Database): Promise<ReturnType<typeof toProjectId>> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "test", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("failed");
  return r.value.id;
}

const pid = () => toProjectId(newId<"ProjectId">());

Deno.test("KnowledgeItem.create —— title / body 校验", () => {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const p = pid();

  const r1 = KnowledgeItem.create({ projectId: p, title: "", body: "b", adoptionKind: "manual", clock });
  assertFalse(r1.ok);
  assertEquals(r1.error.code, "INVALID_INPUT");

  const r2 = KnowledgeItem.create({ projectId: p, title: "t", body: "", adoptionKind: "manual", clock });
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "INVALID_INPUT");

  const r3 = KnowledgeItem.create({ projectId: p, title: "t", body: "b".repeat(100_001), adoptionKind: "manual", clock });
  assertFalse(r3.ok);
  assertEquals(r3.error.code, "INVALID_INPUT");
});

Deno.test("AdoptToKnowledge —— 完整流程：chunk + embed + persist", async () => {
  const db = newDb();
  await db.ready();
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const embedding = new MockEmbeddingProvider({ dimension: 16 });
  const usecase = new AdoptToKnowledgeUseCase({ knowledgeRepo, chunkRepo, embeddingProvider: embedding });
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));

  const projectId = await createTestProject(db);
  const body = Array.from({ length: 8 }, (_, i) => `第${i + 1}段：客户反馈响应慢、报表生成慢。`).join("\n\n");

  const r = await usecase.execute({
    projectId,
    title: "客户痛点摘要",
    body,
    clock,
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.title, "客户痛点摘要");

  // chunks 应被写入
  const chunks = await chunkRepo.listByProject(projectId);
  assert(chunks.length >= 1);

  // metadata 也可读回
  const meta = await knowledgeRepo.findById(r.value.id);
  assert(meta.ok);
  if (!meta.ok) return;
  assertEquals(meta.value.titleValue, "客户痛点摘要");
});

Deno.test("AdoptToKnowledge —— 同 sourceMessageId 第二次 → 返回已有的快照（dedupe）", async () => {
  const db = newDb();
  await db.ready();
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const embedding = new MockEmbeddingProvider({ dimension: 16 });
  const usecase = new AdoptToKnowledgeUseCase({ knowledgeRepo, chunkRepo, embeddingProvider: embedding });
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));

  const projectId = await createTestProject(db);
  const sourceMsgId = "msg-fixed-1";

  const a = await usecase.execute({
    projectId,
    sourceMessageId: toMessageId(sourceMsgId),
    sourceSessionId: toAiSessionId(newId<"AiSessionId">()),
    title: "first",
    body: "first body",
    clock,
  });
  assert(a.ok);
  if (!a.ok) return;

  const b = await usecase.execute({
    projectId,
    sourceMessageId: toMessageId(sourceMsgId),
    sourceSessionId: toAiSessionId(newId<"AiSessionId">()),
    title: "second",
    body: "second body",
    clock,
  });
  assert(b.ok);
  if (!b.ok) return;
  assertEquals(a.value.id, b.value.id);
  assertEquals(b.value.title, "first");
});