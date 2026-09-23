/**
 * SqliteRagProvider 单元测试
 *
 * 覆盖：
 *   - vec 缺失 → 走 LIKE 软降级（score 0.5）
 *   - 空项目 → 返回 []
 *   - 多个 chunk 命中 → 都返回
 */

import { assert, assertEquals } from "@std/assert";
import {
  ProjectId as toProjectId,
  newId,
} from "@shared/types/ids.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { KnowledgeItem } from "@backend/domain/knowledge/knowledge-item.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";
import { RetrieveUseCase } from "@backend/application/knowledge/retrieve.ts";
import { MockEmbeddingProvider } from "@backend/ai/embedding/mock-embedding.provider.ts";
import { SqliteRagProvider } from "@backend/ai/context/providers/sqlite-rag.provider.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";

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

async function createTestProject(db: Database): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "t", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("create project failed");
  return r.value.id;
}

async function seedChunks(
  db: Database,
  pid: ProjectId,
  texts: readonly string[],
): Promise<void> {
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const item = KnowledgeItem.create({
    projectId: pid,
    title: "t",
    body: "b",
    adoptionKind: "manual",
    clock,
  });
  assert(item.ok);
  if (!item.ok) return;
  await knowledgeRepo.save(item.value);

  const chunks: KnowledgeChunk[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const c = KnowledgeChunk.create({
      knowledgeId: item.value.id,
      projectId: pid,
      sourceKind: "message",
      ordinal: i,
      chunkText: text,
      tokenCount: Math.ceil(text.length / 2.5),
      embeddingModel: "mock",
      embeddingDim: 4,
      embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    });
    assert(c.ok);
    if (!c.ok) return;
    chunks.push(c.value);
  }
  await chunkRepo.saveChunks(chunks);
}

Deno.test("SqliteRagProvider —— LIKE 软降级：chunk 命中", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createTestProject(db);
  await seedChunks(db, pid, [
    "客户反馈响应慢",
    "报表生成慢",
    "跨系统集成困难",
  ]);

  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  // vec status = null → 走 LIKE
  const retrieve = new RetrieveUseCase({
    chunkRepo,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const provider = new SqliteRagProvider({
    retrieve,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const out = await provider.retrieve({
    query: "响应",
    projectId: pid,
    topK: 10,
    minScore: 0.0,
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].source, "rag");
  assertEquals(out[0].projectId, pid);
  assert(out[0].content.includes("客户反馈响应慢"));
});

Deno.test("SqliteRagProvider —— 无命中 → 空数组", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createTestProject(db);
  await seedChunks(db, pid, ["客户反馈响应慢"]);

  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const retrieve = new RetrieveUseCase({
    chunkRepo,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const provider = new SqliteRagProvider({
    retrieve,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const out = await provider.retrieve({
    query: "完全不存在的关键词",
    projectId: pid,
    topK: 10,
    minScore: 0.0,
  });
  assertEquals(out.length, 0);
});

Deno.test("SqliteRagProvider —— 空项目 → 空数组", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createTestProject(db);

  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const retrieve = new RetrieveUseCase({
    chunkRepo,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const provider = new SqliteRagProvider({
    retrieve,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const out = await provider.retrieve({
    query: "x",
    projectId: pid,
    topK: 10,
    minScore: 0.0,
  });
  assertEquals(out.length, 0);
});

Deno.test("SqliteRagProvider —— 项目不存在 → 空数组", async () => {
  const db = newDb();
  await db.ready();
  const fakePid = toProjectId(newId<"ProjectId">());

  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const retrieve = new RetrieveUseCase({
    chunkRepo,
    embeddingProvider: new MockEmbeddingProvider({ dimension: 4 }),
  });
  const provider = new SqliteRagProvider({
    retrieve,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const out = await provider.retrieve({
    query: "x",
    projectId: fakePid,
    topK: 10,
    minScore: 0.0,
  });
  assertEquals(out.length, 0);
});