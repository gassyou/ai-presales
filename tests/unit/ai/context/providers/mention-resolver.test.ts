/**
 * MentionResolver 单元测试
 *
 * 覆盖：
 *   - asProjectLookup: 命中 → { projectId, isIndexed }
 *   - isIndexed 取决于 chunk 数（>0 即视为已入库）
 *   - 未命中 → null
 *   - 进程内 cache：同一 token 二次查询只走一次 repo
 *   - invalidateCache 后重新查
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { KnowledgeItem } from "@backend/domain/knowledge/knowledge-item.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { MentionResolver } from "@backend/ai/context/providers/mention-resolver.ts";
import {
  ProjectId as toProjectId,
  newId,
} from "@shared/types/ids.ts";
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

async function createTestProject(db: Database, name: string): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name, clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("create project failed");
  return r.value.id;
}

Deno.test("MentionResolver —— 未命中 → null", async () => {
  const db = newDb();
  await db.ready();
  const resolver = new MentionResolver({
    projectRepo: new SqliteProjectRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
  });
  const lookup = resolver.asProjectLookup();
  const result = await lookup("不存在的项目");
  assertEquals(result, null);
});

Deno.test("MentionResolver —— 命中但未入库 → isIndexed=false", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createTestProject(db, "测试项目");
  const resolver = new MentionResolver({
    projectRepo: new SqliteProjectRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
  });
  const lookup = resolver.asProjectLookup();
  const result = await lookup("测试项目");
  assert(result);
  if (!result) return;
  assertEquals(result.projectId, pid);
  assertEquals(result.isIndexed, false);
});

Deno.test("MentionResolver —— 命中且已入库 → isIndexed=true", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createTestProject(db, "已入库项目");
  // 写一块
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
  const c = KnowledgeChunk.create({
    knowledgeId: item.value.id,
    projectId: pid,
    sourceKind: "message",
    ordinal: 0,
    chunkText: "x",
    tokenCount: 1,
    embeddingModel: "mock",
    embeddingDim: 4,
    embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
  });
  assert(c.ok);
  if (!c.ok) return;
  await chunkRepo.saveChunks([c.value]);

  const resolver = new MentionResolver({
    projectRepo: new SqliteProjectRepository(db),
    chunkRepo,
  });
  const result = await resolver.asProjectLookup()("已入库项目");
  assert(result);
  if (!result) return;
  assertEquals(result.projectId, pid);
  assertEquals(result.isIndexed, true);
});

Deno.test("MentionResolver —— cache 命中：重复 token 不再查 DB", async () => {
  const db = newDb();
  await db.ready();
  const pid = await createTestProject(db, "缓存项目");
  let queryCount = 0;
  const originalFind = SqliteProjectRepository.prototype.findByMentionToken;
  SqliteProjectRepository.prototype.findByMentionToken = async function (
    this: SqliteProjectRepository,
    token: string,
  ) {
    queryCount++;
    return await originalFind.call(this, token);
  };
  try {
    const resolver = new MentionResolver({
      projectRepo: new SqliteProjectRepository(db),
      chunkRepo: new SqliteKnowledgeChunkRepository(db),
    });
    const lookup = resolver.asProjectLookup();
    await lookup("缓存项目");
    await lookup("缓存项目");
    await lookup("缓存项目");
    // 第一次查：1 次 projectRepo；后续 cache 命中不再走
    assertEquals(queryCount, 1);
    // 二次 lookup 也应返回相同结果
    const again = await lookup("缓存项目");
    assertEquals(again?.projectId, pid);
    assertEquals(queryCount, 1);
  } finally {
    SqliteProjectRepository.prototype.findByMentionToken = originalFind;
  }
});

Deno.test("MentionResolver —— invalidateCache 后重新查", async () => {
  const db = newDb();
  await db.ready();
  await createTestProject(db, "失效缓存");
  const resolver = new MentionResolver({
    projectRepo: new SqliteProjectRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
  });
  const lookup = resolver.asProjectLookup();
  await lookup("失效缓存");
  resolver.invalidateCache();
  // invalidate 后再查应能继续走（不抛错）
  const again = await lookup("失效缓存");
  assert(again);
});