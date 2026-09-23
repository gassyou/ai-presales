/**
 * /api/projects/:id/budget-{settings,summary} 路由集成测试
 *
 * 阶段 7.4b。
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import {
  handleBudget,
  type BudgetRouteDeps,
} from "@backend/presentation/routes/budget.route.ts";
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

async function setup(): Promise<{
  pid: ProjectId;
  budget: BudgetRouteDeps;
  bm: BusinessModuleRouteDeps;
}> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "bud-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  const useCase = new StructuredModulesUseCase(bmSvc);
  return {
    pid: r.value.id,
    budget: { useCase, logger: makeLogger() },
    bm: { service: bmSvc, logger: makeLogger() },
  };
}

function pathOnly(url: string): string {
  return url.replace(/^https?:\/[^/]+/, "");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

// ---------- Budget Settings ----------

Deno.test("BudgetSettings — GET 无行 → 200 + defaults", async () => {
  const { pid, budget } = await setup();
  const p = `/api/projects/${pid}/budget-settings`;
  const res = await handleBudget(
    new Request(`http://x${p}`, { method: "GET" }),
    budget,
    pathOnly(p),
  );
  assertEquals(res.status, 200);
  const b = await readJson(res);
  assertEquals(b.unitPrice, 2000);
  assertEquals(b.hoursPerCP, 4);
});

Deno.test("BudgetSettings — PUT → 200 + 持久化", async () => {
  const { pid, budget } = await setup();
  const p = `/api/projects/${pid}/budget-settings`;
  const put = await handleBudget(
    new Request(`http://x${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitPrice: 3000, hoursPerCP: 6 }),
    }),
    budget,
    pathOnly(p),
  );
  assertEquals(put.status, 200);
  const pb = await readJson(put);
  assertEquals(pb.unitPrice, 3000);
  assertEquals(pb.hoursPerCP, 6);

  const get = await handleBudget(
    new Request(`http://x${p}`, { method: "GET" }),
    budget,
    pathOnly(p),
  );
  const gb = await readJson(get);
  assertEquals(gb.unitPrice, 3000);
});

Deno.test("BudgetSettings — PUT 非法 ratio → 400", async () => {
  const { pid, budget } = await setup();
  const p = `/api/projects/${pid}/budget-settings`;
  const put = await handleBudget(
    new Request(`http://x${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reqAnalysisRatio: 1.5 }),
    }),
    budget,
    pathOnly(p),
  );
  assertEquals(put.status, 400);
});

// ---------- Budget Summary ----------

Deno.test("BudgetSummary — GET → 200 + 3 子对象", async () => {
  const { pid, budget } = await setup();
  const p = `/api/projects/${pid}/budget-summary`;
  const res = await handleBudget(
    new Request(`http://x${p}`, { method: "GET" }),
    budget,
    pathOnly(p),
  );
  assertEquals(res.status, 200);
  const b = await readJson(res);
  assert(b.top);
  assert(b.byModule);
  assert(Array.isArray(b.byPhase));
  assertEquals((b.byPhase as unknown[]).length, 9);
});

Deno.test("BudgetSummary — 含功能 → 数值正确", async () => {
  const { pid, budget, bm } = await setup();
  // 通过通用 CRUD 创建 function_list（走 kind=function_list 路径）
  const listPath = `/api/projects/${pid}/modules/function_list/items`;
  await handleBusinessModule(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "X",
        content: "",
        payloadJson: JSON.stringify({
          category: "A",
          module: "M",
          name: "X",
          detail: "",
          remarks: "",
          cp: 5,
          inScope: true,
        }),
      }),
    }),
    bm,
    pathOnly(listPath),
  );

  const p = `/api/projects/${pid}/budget-summary`;
  const res = await handleBudget(
    new Request(`http://x${p}`, { method: "GET" }),
    budget,
    pathOnly(p),
  );
  const b = await readJson(res);
  const top = b.top as { totalCP: number };
  assertEquals(top.totalCP, 5);
});

// ---------- 跨功能模块 + settings 端到端 ----------

Deno.test("端到端 — 改 settings 后 summary 跟着变", async () => {
  const { pid, budget, bm } = await setup();
  const settingsPath = `/api/projects/${pid}/budget-settings`;
  const listPath = `/api/projects/${pid}/modules/function_list/items`;

  // 1) 改单价为 5000
  await handleBudget(
    new Request(`http://x${settingsPath}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitPrice: 5000 }),
    }),
    budget,
    pathOnly(settingsPath),
  );

  // 2) 加一个 CP=5 的功能
  await handleBusinessModule(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "X",
        content: "",
        payloadJson: JSON.stringify({
          category: "A",
          module: "M",
          name: "X",
          detail: "",
          remarks: "",
          cp: 5,
          inScope: true,
        }),
      }),
    }),
    bm,
    pathOnly(listPath),
  );

  // 3) 拿 summary
  const summaryPath = `/api/projects/${pid}/budget-summary`;
  const res = await handleBudget(
    new Request(`http://x${summaryPath}`, { method: "GET" }),
    budget,
    pathOnly(summaryPath),
  );
  const b = await readJson(res);
  const top = b.top as { totalCP: number; functionTotalAmount: number };
  assertEquals(top.totalCP, 5);
  // 5 × 4 × 2.10 = 42 hours / 8 × 5000 = 26250
  assertEquals(Math.round(top.functionTotalAmount), 26250);
});

Deno.test("POST /budget-summary 返回 405（GET only）", async () => {
  const { pid, budget } = await setup();
  const p = `/api/projects/${pid}/budget-summary`;
  const res = await handleBudget(
    new Request(`http://x${p}`, { method: "POST" }),
    budget,
    pathOnly(p),
  );
  assertEquals(res.status, 405);
});
