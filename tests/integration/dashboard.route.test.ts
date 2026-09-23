/**
 * /api/dashboard/* 集成测试（阶段 7.4g）
 *
 * 覆盖：
 *   - GET /api/dashboard/summary → 混合状态 → 数字正确
 *   - GET /api/dashboard/monthly?year=YYYY → 12 行 buckets
 *   - GET /api/dashboard/upcoming-activities?limit=3 → 5 pending 中取 3 ASC
 *   - 空库 → 三端点全空值
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { DashboardUseCase } from "@backend/application/dashboard/dashboard.usecase.ts";
import { handleDashboard } from "@backend/presentation/routes/dashboard.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { newId, type ProjectId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

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

interface Setup {
  projRepo: SqliteProjectRepository;
  projSvc: ProjectService;
  bmService: BusinessModuleService;
  dashboardDeps: import("@backend/presentation/routes/dashboard.route.ts").DashboardRouteDeps;
}

async function setup(seed?: (s: Setup) => Promise<void>): Promise<Setup> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-dashboard-rt-" });
  const db = new Database({
    paths: { root: tmpRoot, data: tmpRoot, logs: tmpRoot, vendor: tmpRoot, output: tmpRoot },
    inMemory: true,
    skipExtensions: true,
  });
  await db.ready();
  const clock = new FixedClock(new Date("2026-09-15T00:00:00Z"));
  const projRepo = new SqliteProjectRepository(db);
  const projSvc = new ProjectService({ repo: projRepo, clock });
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmService = new BusinessModuleService({ repo: bmRepo, clock });

  const useCase = new DashboardUseCase({
    projectRepo: projRepo,
    businessModuleRepo: bmRepo,
    clock,
    yearProvider: () => 2026,
    todayProvider: () => "2026-09-15",
  });
  const deps: Setup = {
    projRepo,
    projSvc,
    bmService,
    dashboardDeps: { logger: makeLogger(), useCase },
  };
  if (seed) await seed(deps);
  return deps;
}

// 构造一个项目（含指定状态 + 状态切换字段）
async function seedProject(
  svc: ProjectService,
  args: {
    name: string;
    clientName: string;
    status?: "新建" | "提案中" | "暂停" | "中标" | "未中标";
    createdAt?: Date;
    updatedAt?: Date;
    wonDate?: Date;
    bestPractice?: string;
    lostDate?: Date;
    lostReason?: string;
  },
): Promise<ProjectId> {
  // 直接 save repo（不走 ProjectService.createProject，因为我们想控制状态 + 状态字段）
  const id = toProjectId(newId<"ProjectId">());
  const { Project } = await import("@backend/domain/project/project.ts");
  const clock = new FixedClock(args.createdAt ?? new Date("2026-09-15T00:00:00Z"));
  const r = Project.create({
    code: `2026-${Math.floor(Math.random() * 99999).toString().padStart(5, "0")}`,
    name: args.name,
    clientName: args.clientName,
    clock,
    id,
  });
  assert(r.ok);
  if (!r.ok) throw new Error("seed project create");
  const p = r.value;
  // 状态推进
  const c2 = new FixedClock(args.updatedAt ?? new Date("2026-09-15T00:00:00Z"));
  if (args.status === "提案中" || args.status === "暂停" || args.status === "中标" || args.status === "未中标") {
    p.changeStatus("提案中", c2);
  }
  if (args.status === "暂停") {
    p.markPaused({ pauseReason: "测试暂停" }, c2);
  } else if (args.status === "中标") {
    p.markWon({ wonDate: args.wonDate ?? new Date("2026-06-01"), bestPractice: args.bestPractice }, c2);
  } else if (args.status === "未中标") {
    p.markLost({
      lostDate: args.lostDate ?? new Date("2026-07-01"),
      lostReason: args.lostReason ?? "测试未中标",
    }, c2);
  }
  const saveR = await svc["repo"].save(p);
  assert(saveR.ok);
  return id;
}

// 构造一条 activity（pending + planDate）
async function seedActivity(
  bmService: BusinessModuleService,
  args: {
    projectId: ProjectId;
    title: string;
    planDate: string;
    status?: "pending" | "adopted" | "unadopted";
  },
): Promise<void> {
  const r = await bmService.createItem(args.projectId, "activity", {
    title: args.title,
    payloadJson: JSON.stringify({ planDate: args.planDate, clientContactName: "Alice" }),
    initialStatus: args.status ?? "pending",
  });
  assert(r.ok);
}

Deno.test("dashboard.summary —— 混合状态 → monthNew / yearWon / yearLost / total 正确", async () => {
  const { projSvc, dashboardDeps } = await setup();
  // 本月（2026-09）新增 3 个
  await seedProject(projSvc, {
    name: "P1",
    clientName: "C1",
    status: "新建",
    createdAt: new Date("2026-09-02T00:00:00Z"),
  });
  await seedProject(projSvc, {
    name: "P2",
    clientName: "C2",
    status: "新建",
    createdAt: new Date("2026-09-10T00:00:00Z"),
  });
  await seedProject(projSvc, {
    name: "P3",
    clientName: "C3",
    status: "新建",
    createdAt: new Date("2026-09-14T00:00:00Z"),
  });
  // 上月（2026-08）1 个
  await seedProject(projSvc, {
    name: "P4-old",
    clientName: "C4",
    status: "新建",
    createdAt: new Date("2026-08-30T00:00:00Z"),
  });
  // 年度中标 2（创建时间在 8 月，避免影响 9 月 monthNew）
  await seedProject(projSvc, {
    name: "W1",
    clientName: "CW1",
    status: "中标",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    wonDate: new Date("2026-03-01"),
  });
  await seedProject(projSvc, {
    name: "W2",
    clientName: "CW2",
    status: "中标",
    createdAt: new Date("2026-08-15T00:00:00Z"),
    wonDate: new Date("2026-08-15"),
  });
  // 年度未中标 1（创建时间在 7 月）
  await seedProject(projSvc, {
    name: "L1",
    clientName: "CL1",
    status: "未中标",
    createdAt: new Date("2026-07-10T00:00:00Z"),
    lostDate: new Date("2026-05-20"),
    lostReason: "预算",
  });

  const url = new URL("http://x/api/dashboard/summary");
  const res = await handleDashboard(
    new Request("http://x/api/dashboard/summary", { method: "GET" }),
    dashboardDeps,
    url,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    monthNew: number;
    yearWon: number;
    yearLost: number;
    total: number;
    asOf: string;
  };
  assertEquals(body.monthNew, 3);
  assertEquals(body.yearWon, 2);
  assertEquals(body.yearLost, 1);
  assertEquals(body.total, 7);
  assertEquals(body.asOf, "2026-09-15T00:00:00.000Z");
});

Deno.test("dashboard.monthly —— 返回 12 行 buckets", async () => {
  const { projSvc, dashboardDeps } = await setup();
  // 1 月新增 1
  await seedProject(projSvc, {
    name: "M1",
    clientName: "CM1",
    createdAt: new Date("2026-01-10T00:00:00Z"),
  });
  // 5 月中标 1
  await seedProject(projSvc, {
    name: "M2-won",
    clientName: "CM2",
    status: "中标",
    wonDate: new Date("2026-05-15"),
  });
  // 9 月未中标 1
  await seedProject(projSvc, {
    name: "M3-lost",
    clientName: "CM3",
    status: "未中标",
    lostDate: new Date("2026-09-01"),
    lostReason: "价格",
  });

  const url = new URL("http://x/api/dashboard/monthly?year=2026");
  const res = await handleDashboard(
    new Request("http://x/api/dashboard/monthly?year=2026", { method: "GET" }),
    dashboardDeps,
    url,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Array<{ month: number; created: number; won: number; lost: number }>;
  assertEquals(body.length, 12);
  assertEquals(body[0].month, 1);
  assertEquals(body[0].created, 1);
  assertEquals(body[4].month, 5);
  assertEquals(body[4].won, 1);
  assertEquals(body[8].month, 9);
  assertEquals(body[8].lost, 1);
});

Deno.test("dashboard.upcoming-activities —— limit=3，5 pending 中取 3 ASC", async () => {
  const { projSvc, bmService, dashboardDeps } = await setup();
  const pid = await seedProject(projSvc, { name: "P-activities", clientName: "C-acts" });
  // 5 条 pending 活动，planDate 散在 9/15 之后
  await seedActivity(bmService, { projectId: pid, title: "A1-far", planDate: "2026-11-30" });
  await seedActivity(bmService, { projectId: pid, title: "A2-near", planDate: "2026-09-16" });
  await seedActivity(bmService, { projectId: pid, title: "A3-mid", planDate: "2026-10-01" });
  await seedActivity(bmService, { projectId: pid, title: "A4-soon", planDate: "2026-09-20" });
  await seedActivity(bmService, { projectId: pid, title: "A5-mid-late", planDate: "2026-10-20" });
  // 1 条昨天（应排除）
  await seedActivity(bmService, { projectId: pid, title: "A6-yesterday", planDate: "2026-09-14" });
  // 1 条已采纳（应排除）
  await seedActivity(bmService, {
    projectId: pid,
    title: "A7-adopted",
    planDate: "2026-10-05",
    status: "adopted",
  });

  const url = new URL("http://x/api/dashboard/upcoming-activities?limit=3");
  const res = await handleDashboard(
    new Request("http://x/api/dashboard/upcoming-activities?limit=3", { method: "GET" }),
    dashboardDeps,
    url,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Array<{ title: string; planDate: string }>;
  assertEquals(body.length, 3);
  assertEquals(body[0].title, "A2-near");
  assertEquals(body[1].title, "A4-soon");
  assertEquals(body[2].title, "A3-mid");
});

Deno.test("dashboard —— 空库 → summary 全 0 / monthly 12 行 0 / activities 空", async () => {
  const { dashboardDeps } = await setup();

  // summary
  const summaryRes = await handleDashboard(
    new Request("http://x/api/dashboard/summary", { method: "GET" }),
    dashboardDeps,
    new URL("http://x/api/dashboard/summary"),
  );
  assertEquals(summaryRes.status, 200);
  const summary = await summaryRes.json() as { monthNew: number; yearWon: number; yearLost: number; total: number };
  assertEquals(summary.monthNew, 0);
  assertEquals(summary.yearWon, 0);
  assertEquals(summary.yearLost, 0);
  assertEquals(summary.total, 0);

  // monthly
  const monthlyRes = await handleDashboard(
    new Request("http://x/api/dashboard/monthly?year=2026", { method: "GET" }),
    dashboardDeps,
    new URL("http://x/api/dashboard/monthly?year=2026"),
  );
  assertEquals(monthlyRes.status, 200);
  const monthly = await monthlyRes.json() as Array<{ month: number; created: number; won: number; lost: number }>;
  assertEquals(monthly.length, 12);
  assert(monthly.every((m) => m.created === 0 && m.won === 0 && m.lost === 0));

  // upcoming
  const upcomingRes = await handleDashboard(
    new Request("http://x/api/dashboard/upcoming-activities", { method: "GET" }),
    dashboardDeps,
    new URL("http://x/api/dashboard/upcoming-activities"),
  );
  assertEquals(upcomingRes.status, 200);
  const upcoming = await upcomingRes.json() as unknown[];
  assertEquals(upcoming.length, 0);
});
