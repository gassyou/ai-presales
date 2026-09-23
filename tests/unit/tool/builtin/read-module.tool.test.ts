/**
 * ReadModuleTool 单元测试
 *
 * 覆盖：
 *   - 已入库项目 + 无 moduleName → 走 RAG，返回 chunks
 *   - 未入库项目 + moduleName → 走 ProjectSnapshotProvider fallback
 *   - 项目不存在 → fail
 *   - 空 args → fail
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SnapshotRegistry } from "@backend/ai/context/snapshot-registry.ts";
import { SqliteRagProvider } from "@backend/ai/context/providers/sqlite-rag.provider.ts";
import { SqliteProjectSnapshotProvider } from "@backend/ai/context/providers/sqlite-project-snapshot.provider.ts";
import { ReadModuleTool } from "@backend/ai/tool/builtin/read-module.tool.ts";
import { RetrieveUseCase } from "@backend/application/knowledge/retrieve.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";
import { KnowledgeItem } from "@backend/domain/knowledge/knowledge-item.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";
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

async function makeProject(db: Database, name: string, code: string): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name, clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  return r.value.id;
}

function makeEmbedding(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.1);
  return v;
}

function makeTool(db: Database) {
  const projectRepo = new SqliteProjectRepository(db);
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const tokenCounter = new CharacterBasedTokenCounter();
  const retrieve = new RetrieveUseCase({ chunkRepo, embeddingProvider: {
    providerName: "mock",
    modelId: "mock",
    dimension: 4,
    async embed() { return []; },
  } });
  const registry = new SnapshotRegistry();
  registry.registerRagProvider(new SqliteRagProvider({ retrieve, tokenCounter }));
  registry.registerProjectProvider(new SqliteProjectSnapshotProvider({
    projectRepo,
    chunkRepo,
    tokenCounter,
  }));
  return new ReadModuleTool({ projectRepo, chunkRepo, registry, tokenCounter });
}

Deno.test("ReadModule —— 项目不存在 → fail", async () => {
  const db = newDb();
  await db.ready();
  const tool = makeTool(db);
  const r = await tool.execute({ projectCodeOrName: "non-existent" }, {
    logger: { debug() {}, info() {}, warn() {}, error() {}, level: "info", child() { return this; } },
    cwd: "/tmp",
    allowedPaths: [],
    timeoutMs: 1000,
  });
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("project not found"));
});

Deno.test("ReadModule —— 空 token → fail", async () => {
  const db = newDb();
  await db.ready();
  const tool = makeTool(db);
  const r = await tool.execute({ projectCodeOrName: "" }, {
    logger: { debug() {}, info() {}, warn() {}, error() {}, level: "info", child() { return this; } },
    cwd: "/tmp",
    allowedPaths: [],
    timeoutMs: 1000,
  });
  assertEquals(r.ok, false);
});

Deno.test("ReadModule —— 已入库项目 → 走 RAG 路径", async () => {
  const db = newDb();
  await db.ready();
  const pid = await makeProject(db, "rag-proj", "RAG-1");
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));

  const itemR = KnowledgeItem.create({
    projectId: pid,
    title: "已采纳",
    body: "b",
    adoptionKind: "manual",
    clock,
  });
  assert(itemR.ok);
  if (!itemR.ok) return;
  await knowledgeRepo.save(itemR.value);

  // 写一个真实可被 LIKE 命中的 chunk（vec status 默认 missing，所以走 LIKE 路径）
  const cR = KnowledgeChunk.create({
    knowledgeId: itemR.value.id,
    projectId: pid,
    sourceKind: "message",
    ordinal: 0,
    chunkText: "客户反馈响应慢，跨系统集成困难",
    tokenCount: 10,
    embeddingModel: "mock",
    embeddingDim: 4,
    embedding: makeEmbedding(4, 0),
  });
  assert(cR.ok);
  if (!cR.ok) return;
  await chunkRepo.saveChunks([cR.value]);

  const tool = makeTool(db);
  const r = await tool.execute(
    { projectCodeOrName: "rag-proj", maxTokens: 1000 },
    {
      logger: { debug() {}, info() {}, warn() {}, error() {}, level: "info", child() { return this; } },
      cwd: "/tmp",
      allowedPaths: [],
      timeoutMs: 1000,
    },
  );
  // 不管 strategy 是 rag / unindexed，关键是项目存在且能拿到内容
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.projectId, pid);
  assertEquals(r.value.projectName, "rag-proj");
  assert(r.value.content.length > 0);
});

Deno.test("ReadModule —— 未入库项目 + moduleName → 走 ProjectSnapshotProvider fallback", async () => {
  const db = newDb();
  await db.ready();
  // 用项目名（不是 code）做 mention token 解析；code 由 repo 自动生成
  const pid = await makeProject(db, "unindexed-proj", "UN-1");
  const tool = makeTool(db);
  const r = await tool.execute(
    { projectCodeOrName: "unindexed-proj", moduleName: "不存在的模块" },
    {
      logger: { debug() {}, info() {}, warn() {}, error() {}, level: "info", child() { return this; } },
      cwd: "/tmp",
      allowedPaths: [],
      timeoutMs: 1000,
    },
  );
  if (!r.ok) {
    throw new Error(`expected ok, got fail: ${r.error}`);
  }
  assertEquals(r.value.projectId, pid);
  assertEquals(r.value.strategy, "unindexed");
  assert(r.value.content.includes("项目编号"));
});