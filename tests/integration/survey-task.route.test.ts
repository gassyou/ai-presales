/**
 * 调查任务路由集成测试
 *
 * 阶段 7.1。覆盖：
 *   - POST /api/projects/:id/modules/survey_task/items         创建
 *   - POST ?action=batchGenerate                                批量生成
 *   - POST /api/modules/items/:id/start                          启动后 taskStatus=running
 *   - POST /api/modules/items/:id/stop                           终止后 taskStatus=aborted
 *   - POST /api/modules/items/:id/adopt                          采纳调查结果
 *   - GET /api/modules/items/:id                                 taskStatus=completed 异步结束
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import {
  handleBusinessModule,
  type BusinessModuleRouteDeps,
} from "@backend/presentation/routes/business-module.route.ts";
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

async function setup(): Promise<{ pid: ProjectId; deps: BusinessModuleRouteDeps }> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const ps = new ProjectService({ repo: projRepo, clock });
  const r = await ps.createProject({ name: "survey-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");

  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  const useCase = new SurveyTaskUseCase({
    businessModuleService: bmSvc,
    clock,
    simulateDurationMs: 30,
  });

  return {
    pid: r.value.id,
    deps: { logger: makeLogger(), service: bmSvc, surveyTaskUseCase: useCase },
  };
}

Deno.test("POST 创建调查任务", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  const req = new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "客户背景信息",
      content: "请调查年度营业额",
      payloadJson: JSON.stringify({ topicHint: "客户背景" }),
    }),
  });
  const res = await handleBusinessModule(req, deps, path);
  assertEquals(res.status, 201);
  const body = await res.json() as { taskStatus: string; topicHint: string };
  assertEquals(body.taskStatus, "idle");
  assertEquals(body.topicHint, "客户背景");
});

Deno.test("POST ?action=batchGenerate —— 批量生成", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  const req = new Request(`http://x${path}?action=batchGenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topics: ["客户背景", "行业背景", "技术趋势"] }),
  });
  const res = await handleBusinessModule(req, deps, path);
  assertEquals(res.status, 201);
  const body = await res.json() as { items: { title: string; taskStatus: string }[] };
  assertEquals(body.items.length, 3);
  for (const it of body.items) {
    assertEquals(it.taskStatus, "idle");
  }
});

Deno.test("POST start —— 异步执行完毕变 completed", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X", content: "" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };

  const startRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/start`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/start`,
  );
  assertEquals(startRes.status, 200);
  const started = await startRes.json() as { taskStatus: string };
  assertEquals(started.taskStatus, "running");

  // 等异步完成
  await new Promise((res) => setTimeout(res, 80));
  const final = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, { method: "GET" }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  const finalBody = await final.json() as { taskStatus: string; resultContent: string };
  assertEquals(finalBody.taskStatus, "completed");
  assertStringIncludes(finalBody.resultContent, "调查：X");
});

Deno.test("POST stop —— 终止后 taskStatus=aborted", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Y", content: "" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };

  await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/start`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/start`,
  );
  const stopRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/stop`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/stop`,
  );
  const stopped = await stopRes.json() as { taskStatus: string };
  assertEquals(stopped.taskStatus, "aborted");
});

Deno.test("POST start —— 重复 start 返回 400", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Z", content: "" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const a = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/start`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/start`,
  );
  assertEquals(a.status, 200);
  const b = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/start`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/start`,
  );
  assertEquals(b.status, 400);
  await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/stop`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/stop`,
  );
});

Deno.test("POST start —— 非 survey_task 类型 → 400", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/activity/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "act" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const res = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/start`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/start`,
  );
  assertEquals(res.status, 400);
  const body = await res.json() as { code: string };
  assertStringIncludes(body.code, "BAD_REQUEST");
});

Deno.test("POST adopt —— 采纳调查结果", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "adoptable", content: "调查结论…" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const adoptRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/adopt`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/adopt`,
  );
  assertEquals(adoptRes.status, 200);
  const adopted = await adoptRes.json() as { status: string };
  assertEquals(adopted.status, "adopted");
});

Deno.test("业务模块 list —— GET 列表返回所有 survey_task", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/survey_task/items`;
  for (const t of ["A", "B", "C"]) {
    await handleBusinessModule(
      new Request(`http://x${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t }),
      }),
      deps,
      path,
    );
  }
  const list = await handleBusinessModule(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  const body = await list.json() as { items: unknown[] };
  assertEquals(body.items.length, 3);
});
