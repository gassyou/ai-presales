/**
 * /api/projects/:id/knowledge/* 路由集成测试
 *
 * 覆盖：
 *   - GET status：空项目 isIndexed=false
 *   - POST ingest：无消息 → scanned=0
 *   - POST ingest：有消息 → 写入 knowledge + chunks
 *   - GET status：ingest 后 isIndexed=true, lastIngestedAt 非空
 */

import { assert, assertEquals } from "@std/assert";
import { handleKnowledge } from "@backend/presentation/routes/knowledge.route.ts";
import type { KnowledgeRouteDeps } from "@backend/presentation/routes/knowledge.route.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { IngestProjectUseCase } from "@backend/application/knowledge/ingest-project.usecase.ts";
import { IndexStatusUseCase } from "@backend/application/knowledge/index-status.usecase.ts";
import { MockEmbeddingProvider } from "@backend/ai/embedding/mock-embedding.provider.ts";
import { AiSession } from "@backend/domain/ai-session/ai-session.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
}

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

async function setup(db: Database): Promise<{ pid: ProjectId; deps: KnowledgeRouteDeps }> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "knowledge-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");

  const sessionRepo = new SqliteAiSessionRepository(db);
  const knowledgeRepo = new SqliteKnowledgeRepository(db);
  const chunkRepo = new SqliteKnowledgeChunkRepository(db);
  const embeddingProvider = new MockEmbeddingProvider({ dimension: 4 });
  const ingest = new IngestProjectUseCase({
    sessionRepo, knowledgeRepo, chunkRepo, embeddingProvider,
  });
  const status = new IndexStatusUseCase({ knowledgeRepo, chunkRepo, sessionRepo });

  return {
    pid: r.value.id,
    deps: {
      logger: makeLogger(),
      ingest,
      status,
      clock,
    },
  };
}

Deno.test("GET status —— 空项目 isIndexed=false, chunkCount=0", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const req = new Request(`http://x/api/projects/${pid}/knowledge/status`, { method: "GET" });
  const res = await handleKnowledge(req, deps, `/api/projects/${pid}/knowledge/status`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.isIndexed, false);
  assertEquals(body.chunkCount, 0);
  assertEquals(body.lastIngestedAt, null);
});

Deno.test("POST ingest —— 无消息：scanned=0", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const req = new Request(`http://x/api/projects/${pid}/knowledge/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await handleKnowledge(req, deps, `/api/projects/${pid}/knowledge/ingest`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.scanned, 0);
  assertEquals(body.indexed, 0);
});

Deno.test("POST ingest + GET status —— 端到端", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);

  // seed session + messages
  const sessionRepo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const sR = AiSession.create({ projectId: pid, subAgentName: "x", title: "x", clock });
  assert(sR.ok);
  if (!sR.ok) return;
  const s = sR.value;
  s.appendMessage({ role: "user", content: "客户反馈响应慢" }, clock);
  s.appendMessage({ role: "assistant", content: "已记录痛点" }, clock);
  await sessionRepo.save(s);

  // ingest
  const req1 = new Request(`http://x/api/projects/${pid}/knowledge/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageLimit: 100 }),
  });
  const res1 = await handleKnowledge(req1, deps, `/api/projects/${pid}/knowledge/ingest`);
  assertEquals(res1.status, 200);
  const body1 = await res1.json();
  assertEquals(body1.scanned, 2);
  assertEquals(body1.indexed, 2);

  // status
  const req2 = new Request(`http://x/api/projects/${pid}/knowledge/status`, { method: "GET" });
  const res2 = await handleKnowledge(req2, deps, `/api/projects/${pid}/knowledge/status`);
  assertEquals(res2.status, 200);
  const body2 = await res2.json();
  assertEquals(body2.isIndexed, true);
  assertEquals(body2.chunkCount, body1.totalChunks);
  assertEquals(body2.knowledgeItemCount, 2);
  assertEquals(body2.messageCount, 2);
  assert(body2.lastIngestedAt !== null);
});

Deno.test("POST ingest 二次幂等 —— 第二轮全部 skipped", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);

  const sessionRepo = new SqliteAiSessionRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const sR = AiSession.create({ projectId: pid, subAgentName: "x", title: "x", clock });
  assert(sR.ok);
  if (!sR.ok) return;
  const s = sR.value;
  s.appendMessage({ role: "user", content: "msg" }, clock);
  await sessionRepo.save(s);

  const path = `/api/projects/${pid}/knowledge/ingest`;
  const mkReq = () => new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await handleKnowledge(mkReq(), deps, path);
  const res2 = await handleKnowledge(mkReq(), deps, path);
  assertEquals(res2.status, 200);
  const body = await res2.json();
  assertEquals(body.scanned, 1);
  assertEquals(body.indexed, 0);
  assertEquals(body.skipped, 1);
});