/**
 * /api/projects/:id/{use-cases,deliverables,reviews} 路由集成测试
 *
 * 阶段 7.4a。覆盖三模块的列表 / 新建 / 更新 / 删除 + Review summary。
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import {
  handleStructuredModules,
  type StructuredModulesRouteDeps,
} from "@backend/presentation/routes/structured-modules.route.ts";
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

async function setup(): Promise<{ pid: ProjectId; deps: StructuredModulesRouteDeps }> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "sm-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  return {
    pid: r.value.id,
    deps: { logger: makeLogger(), useCase: new StructuredModulesUseCase(bmSvc) },
  };
}

function pathOnly(url: string): string {
  return url.replace(/^https?:\/[^/]+/, "");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

Deno.test("UseCase — POST + GET 列表", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/use-cases`;
  const post = await handleStructuredModules(
    new Request(`http://x${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "UC1", caseId: "UC-001", businessRules: "BR" }),
    }),
    deps,
    pathOnly(p),
  );
  assertEquals(post.status, 201);
  const created = await readJson(post);
  assertEquals(created.title, "UC1");
  assertEquals(created.caseId, "UC-001");

  const list = await handleStructuredModules(
    new Request(`http://x${p}`, { method: "GET" }),
    deps,
    pathOnly(p),
  );
  assertEquals(list.status, 200);
  const lb = await readJson(list);
  assertEquals((lb.items as unknown[]).length, 1);
});

Deno.test("UseCase — PATCH + DELETE", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/use-cases`;
  const post = await handleStructuredModules(
    new Request(`http://x${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "UC" }),
    }),
    deps,
    pathOnly(p),
  );
  const c = await readJson(post);
  const id = c.id as string;

  const patch = await handleStructuredModules(
    new Request(`http://x/api/use-cases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "UC v2", caseId: "UC-002" }),
    }),
    deps,
    `/api/use-cases/${id}`,
  );
  assertEquals(patch.status, 200);
  const pb = await readJson(patch);
  assertEquals(pb.title, "UC v2");
  assertEquals(pb.caseId, "UC-002");

  const del = await handleStructuredModules(
    new Request(`http://x/api/use-cases/${id}`, { method: "DELETE" }),
    deps,
    `/api/use-cases/${id}`,
  );
  assertEquals(del.status, 204);
});

Deno.test("UseCase — 空标题返回 400", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/use-cases`;
  const post = await handleStructuredModules(
    new Request(`http://x${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  " }),
    }),
    deps,
    pathOnly(p),
  );
  assertEquals(post.status, 400);
  const b = await readJson(post);
  assertEquals(b.code, "INVALID_INPUT");
});

Deno.test("Deliverable — POST + PATCH status + GET 列表", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/deliverables`;
  const post = await handleStructuredModules(
    new Request(`http://x${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "说明书",
        type: "文档",
        owner: "张三",
        dueDate: "2026-12-31",
        status: "in_progress",
      }),
    }),
    deps,
    pathOnly(p),
  );
  assertEquals(post.status, 201);
  const c = await readJson(post);
  assertEquals(c.status, "in_progress");
  assertEquals(c.type, "文档");
  const id = c.id as string;

  const patch = await handleStructuredModules(
    new Request(`http://x/api/deliverables/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    }),
    deps,
    `/api/deliverables/${id}`,
  );
  assertEquals(patch.status, 200);
  const pb = await readJson(patch);
  assertEquals(pb.status, "completed");
  assertEquals(pb.owner, "张三");
});

Deno.test("Deliverable — 非法 status 返回 400", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/deliverables`;
  const post = await handleStructuredModules(
    new Request(`http://x${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X", status: "garbage" }),
    }),
    deps,
    pathOnly(p),
  );
  assertEquals(post.status, 400);
});

Deno.test("Review — POST + GET 列表含 summary", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/reviews`;
  for (const it of [
    { dimension: "业务价值", score: 8, weight: 0.5 },
    { dimension: "技术可行性", score: 6, weight: 0.5 },
  ]) {
    const post = await handleStructuredModules(
      new Request(`http://x${p}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: it.dimension, ...it }),
      }),
      deps,
      pathOnly(p),
    );
    assertEquals(post.status, 201);
  }

  const list = await handleStructuredModules(
    new Request(`http://x${p}`, { method: "GET" }),
    deps,
    pathOnly(p),
  );
  assertEquals(list.status, 200);
  const lb = await readJson(list);
  assertEquals((lb.items as unknown[]).length, 2);
  const summary = lb.summary as { totalScore: number; itemCount: number };
  assertEquals(summary.itemCount, 2);
  // (8*0.5 + 6*0.5) / 1 = 7
  assertEquals(Math.round(summary.totalScore * 1000), 7000);
});

Deno.test("Review — GET summary 单独", async () => {
  const { pid, deps } = await setup();
  const p = `/api/projects/${pid}/reviews/summary`;
  const res = await handleStructuredModules(
    new Request(`http://x${p}`, { method: "GET" }),
    deps,
    pathOnly(p),
  );
  assertEquals(res.status, 200);
  const b = await readJson(res);
  assertEquals(b.itemCount, 0);
  assertEquals(b.totalScore, 0);
});

Deno.test("Review — PATCH + DELETE", async () => {
  const { pid, deps } = await setup();
  const list = `/api/projects/${pid}/reviews`;
  const post = await handleStructuredModules(
    new Request(`http://x${list}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "维度", dimension: "x", score: 5, weight: 1 }),
    }),
    deps,
    list,
  );
  const c = await readJson(post);
  const id = c.id as string;

  const patch = await handleStructuredModules(
    new Request(`http://x/api/reviews/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ score: 9, comment: "OK" }),
    }),
    deps,
    `/api/reviews/${id}`,
  );
  assertEquals(patch.status, 200);
  const pb = await readJson(patch);
  assertEquals(pb.score, 9);
  assertEquals(pb.comment, "OK");

  const del = await handleStructuredModules(
    new Request(`http://x/api/reviews/${id}`, { method: "DELETE" }),
    deps,
    `/api/reviews/${id}`,
  );
  assertEquals(del.status, 204);
});

Deno.test("三种模块互不串扰", async () => {
  const { pid, deps } = await setup();
  const ucList = await handleStructuredModules(
    new Request(`http://x/api/projects/${pid}/use-cases`, { method: "GET" }),
    deps,
    `/api/projects/${pid}/use-cases`,
  );
  const dlList = await handleStructuredModules(
    new Request(`http://x/api/projects/${pid}/deliverables`, { method: "GET" }),
    deps,
    `/api/projects/${pid}/deliverables`,
  );
  const rvList = await handleStructuredModules(
    new Request(`http://x/api/projects/${pid}/reviews`, { method: "GET" }),
    deps,
    `/api/projects/${pid}/reviews`,
  );
  for (const r of [ucList, dlList, rvList]) assertEquals(r.status, 200);
});
