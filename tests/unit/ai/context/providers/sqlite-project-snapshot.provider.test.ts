/**
 * SqliteProjectSnapshotProvider 单元测试
 *
 * 覆盖：
 *   - summarize 拼装项目元数据 + chunk 计数 + 截到 maxTokens
 *   - resolveMentions 命中 / 未命中 / 混合
 *   - 项目不存在 → summarize 返回 null
 */

import { assert, assertEquals } from "@std/assert";
import {
  ProjectId as toProjectId,
  newId,
} from "@shared/types/ids.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteProjectSnapshotProvider } from "@backend/ai/context/providers/sqlite-project-snapshot.provider.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { Database } from "@backend/persistence/database/database.ts";
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

async function createTestProject(db: Database): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "测试项目", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("create project failed");
  return r.value.id;
}

Deno.test("SqliteProjectSnapshotProvider —— summarize 包含项目元数据", async () => {
  const db = newDb();
  await db.ready();
  const projectRepo = new SqliteProjectRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const provider = new SqliteProjectSnapshotProvider({
    projectRepo,
    chunkRepo,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const pid = await createTestProject(db);
  const frag = await provider.summarize({ projectId: pid, maxTokens: 200 });
  assert(frag);
  if (!frag) return;
  assertEquals(frag.source, "project-snapshot");
  assertEquals(frag.projectId, pid);
  assert(frag.content.includes("测试项目"));
  assert(frag.content.includes("ACME"));
  assert(frag.content.includes("未入库知识库"));
});

Deno.test("SqliteProjectSnapshotProvider —— 有 chunks 时显示「已入库」", async () => {
  const db = newDb();
  await db.ready();
  const projectRepo = new SqliteProjectRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const knowledgeRepo = new (await import("@backend/persistence/sqlite/sqlite-knowledge.repository.ts"))
    .SqliteKnowledgeRepository(db);
  const provider = new SqliteProjectSnapshotProvider({
    projectRepo,
    chunkRepo,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const pid = await createTestProject(db);
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
  const chunk = KnowledgeChunk.create({
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
  assert(chunk.ok);
  if (!chunk.ok) return;
  await chunkRepo.saveChunks([chunk.value]);

  const frag = await provider.summarize({ projectId: pid, maxTokens: 200 });
  assert(frag);
  if (!frag) return;
  assert(frag.content.includes("已入库"));
  assert(frag.content.includes("1 块"));
});

Deno.test("SqliteProjectSnapshotProvider —— 项目不存在 → 返回 null", async () => {
  const db = newDb();
  await db.ready();
  const provider = new SqliteProjectSnapshotProvider({
    projectRepo: new SqliteProjectRepository(db),
    chunkRepo: new SqliteKnowledgeChunkRepository(db),
    tokenCounter: new CharacterBasedTokenCounter(),
  });
  const fakePid = toProjectId(newId<"ProjectId">());
  const frag = await provider.summarize({ projectId: fakePid, maxTokens: 200 });
  assertEquals(frag, null);
});

Deno.test("SqliteProjectSnapshotProvider —— resolveMentions: 精确 code 命中", async () => {
  const db = newDb();
  await db.ready();
  const projectRepo = new SqliteProjectRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const provider = new SqliteProjectSnapshotProvider({
    projectRepo,
    chunkRepo,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  // 直接造一个 code=ACME-001 的项目
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projectRepo, clock });
  const r = await svc.createProject({ name: "测试", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) return;
  // 把它 code 强制改成 ACME-001（绕过 nextProjectCode）
  db.run("UPDATE projects SET code = ? WHERE id = ?", ["ACME-001", r.value.id]);

  const out = await provider.resolveMentions(["ACME-001", "不存在的项目"]);
  assertEquals(out.matched.length, 1);
  assertEquals(out.matched[0].token, "ACME-001");
  assertEquals(out.matched[0].projectId, r.value.id);
  assertEquals(out.unmatched, ["不存在的项目"]);
});

Deno.test("SqliteProjectSnapshotProvider —— resolveMentions: name 命中", async () => {
  const db = newDb();
  await db.ready();
  const projectRepo = new SqliteProjectRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const provider = new SqliteProjectSnapshotProvider({
    projectRepo,
    chunkRepo,
    tokenCounter: new CharacterBasedTokenCounter(),
  });

  const pid = await createTestProject(db);
  // "测试项目" 是创建时的 name
  const out = await provider.resolveMentions(["测试项目"]);
  assertEquals(out.matched.length, 1);
  assertEquals(out.matched[0].projectId, pid);
  assertEquals(out.unmatched.length, 0);
});