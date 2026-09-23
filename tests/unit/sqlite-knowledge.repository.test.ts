/**
 * SqliteKnowledgeRepository + SqliteKnowledgeChunkRepository 集成测试
 *
 * 覆盖：
 *   - KnowledgeItem save + findById round-trip
 *   - findBySourceMessage dedupe
 *   - KnowledgeChunk saveChunks + listByProject
 *   - searchByLike 命中
 *   - vec status 读写
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  KnowledgeItemId as toKnowledgeItemId,
  MessageId as toMessageId,
  ProjectId as toProjectId,
  newId,
} from "@shared/types/ids.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { KnowledgeItem } from "@backend/domain/knowledge/knowledge-item.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";

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

function makeEmbedding(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.1);
  return v;
}

Deno.test("knowledge —— save + findById round-trip", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteKnowledgeRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const pid = await createTestProject(db);

  const r = KnowledgeItem.create({
    projectId: pid,
    title: "客户痛点",
    body: "客户反馈响应慢、报表生成慢、跨系统集成困难。",
    adoptionKind: "manual",
    clock,
  });
  assert(r.ok);
  if (!r.ok) return;

  const save = await repo.save(r.value);
  assert(save.ok);

  const got = await repo.findById(r.value.id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.titleValue, "客户痛点");
  assertEquals(got.value.bodyValue, "客户反馈响应慢、报表生成慢、跨系统集成困难。");
  assertEquals(got.value.adoptionKindValue, "manual");
});

Deno.test("knowledge —— findBySourceMessage dedupe", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteKnowledgeRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const pid = await createTestProject(db);

  const r1 = KnowledgeItem.create({
    projectId: pid,
    title: "t1",
    body: "b1",
    adoptionKind: "manual",
    clock,
    sourceMessageId: toMessageId("msg-1"),
  });
  assert(r1.ok);
  if (!r1.ok) return;
  await repo.save(r1.value);

  const found = await repo.findBySourceMessage("msg-1");
  assert(found);
  assertEquals(found?.id, r1.value.id);
});

Deno.test("knowledge —— list by project + 分页", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteKnowledgeRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const pid = await createTestProject(db);

  for (let i = 0; i < 5; i++) {
    const r = KnowledgeItem.create({
      projectId: pid,
      title: `t${i}`,
      body: `b${i}`,
      adoptionKind: "manual",
      clock,
    });
    assert(r.ok);
    if (!r.ok) return;
    await repo.save(r.value);
    clock.advance(1000);
  }
  const list = await repo.list({ projectId: pid, limit: 3, offset: 0 });
  assertEquals(list.total, 5);
  assertEquals(list.items.length, 3);
  // 倒序：t4 在最前
  assertEquals(list.items[0].title, "t4");
});

Deno.test("chunks —— saveChunks + listByProject", async () => {
  const db = newDb();
  await db.ready();
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const pid = await createTestProject(db);

  const item = KnowledgeItem.create({
    projectId: pid,
    title: "t",
    body: "long body",
    adoptionKind: "manual",
    clock,
  });
  assert(item.ok);
  if (!item.ok) return;
  await knowledgeRepo.save(item.value);

  const chunks: KnowledgeChunk[] = [];
  for (let i = 0; i < 3; i++) {
    const c = KnowledgeChunk.create({
      knowledgeId: item.value.id,
      projectId: pid,
      sourceKind: "message",
      ordinal: i,
      chunkText: `chunk-${i}`,
      tokenCount: 10,
      embeddingModel: "mock",
      embeddingDim: 16,
      embedding: makeEmbedding(16, i),
    });
    assert(c.ok);
    if (!c.ok) return;
    chunks.push(c.value);
  }
  await chunkRepo.saveChunks(chunks);

  const list = await chunkRepo.listByProject(pid);
  assertEquals(list.length, 3);
  for (let i = 0; i < 3; i++) {
    assertEquals(list[i].ordinal, i);
    assertEquals(list[i].chunkText, `chunk-${i}`);
  }
});

Deno.test("chunks —— searchByLike 命中", async () => {
  const db = newDb();
  await db.ready();
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const pid = await createTestProject(db);

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
  for (const text of [
    "客户反馈响应慢",
    "报表生成慢",
    "跨系统集成困难",
  ]) {
    const c = KnowledgeChunk.create({
      knowledgeId: item.value.id,
      projectId: pid,
      sourceKind: "message",
      ordinal: chunks.length,
      chunkText: text,
      tokenCount: 5,
      embeddingModel: "mock",
      embeddingDim: 16,
      embedding: makeEmbedding(16, chunks.length),
    });
    assert(c.ok);
    if (!c.ok) return;
    chunks.push(c.value);
  }
  await chunkRepo.saveChunks(chunks);

  const hits = await chunkRepo.searchByLike(pid, "响应", 10);
  assertEquals(hits.length, 1);
  assertEquals(hits[0].chunkText, "客户反馈响应慢");

  const noHits = await chunkRepo.searchByLike(pid, "不存在的关键词", 10);
  assertEquals(noHits.length, 0);
});

Deno.test("chunks —— markDirty + listDirtyByProject + clearDirty", async () => {
  const db = newDb();
  await db.ready();
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const pid = await createTestProject(db);

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
  for (let i = 0; i < 2; i++) {
    const c = KnowledgeChunk.create({
      knowledgeId: item.value.id,
      projectId: pid,
      sourceKind: "message",
      ordinal: i,
      chunkText: `chunk-${i}`,
      tokenCount: 5,
      embeddingModel: "mock",
      embeddingDim: 16,
      embedding: makeEmbedding(16, i),
    });
    assert(c.ok);
    if (!c.ok) return;
    chunks.push(c.value);
  }
  await chunkRepo.saveChunks(chunks);

  // 标记全部 dirty
  const changed = await chunkRepo.markDirty(item.value.id);
  assertEquals(changed, 2);

  const dirty = await chunkRepo.listDirtyByProject(pid);
  assertEquals(dirty.length, 2);

  // 清除第一块 dirty
  const cleared = await chunkRepo.clearDirty([dirty[0].id]);
  assertEquals(cleared, 1);
  const stillDirty = await chunkRepo.listDirtyByProject(pid);
  assertEquals(stillDirty.length, 1);
});

Deno.test("vec status —— 默认 null，write 后 read 出来", async () => {
  const db = newDb();
  await db.ready();
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);

  assertEquals(chunkRepo.readVecStatus(), null);
  chunkRepo.writeVecStatus("missing", "extension not found");
  const got = chunkRepo.readVecStatus();
  assert(got);
  assertEquals(got?.status, "missing");
  assertEquals(got?.reason, "extension not found");

  chunkRepo.writeVecStatus("loaded", null);
  const loaded = chunkRepo.readVecStatus();
  assertEquals(loaded?.status, "loaded");
  assertEquals(loaded?.reason, null);
});

Deno.test("knowledge —— delete 返回 NOT_FOUND 当不存在", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteKnowledgeRepository(db);
  const r = await repo.delete(toKnowledgeItemId(newId<"KnowledgeItemId">()));
  assertFalse(r.ok);
  assertEquals(r.error.code, "NOT_FOUND");
});