/**
 * 任务 1：项目状态扩展（中止 + 必填强化）—— 测试
 *
 * 覆盖：
 *   - ProjectStatusVO 新增 "中止" + transition 规则
 *   - Project.markWon.bestPractice 必填
 *   - Project.markLost.improvementNote 必填
 *   - Project.markStopped（终态）日期 + 原因必填
 *   - ProjectService.changeProjectStatus 中止分支路由
 *   - ProjectService 中标/未中标必填字段校验
 *   - writeable-tools 中 write_project_status 中止分支
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { Project } from "@backend/domain/project/project.ts";
import { ProjectStatus, PROJECT_STATUSES } from "@backend/domain/project/project-status.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { WriteProjectStatusTool } from "@backend/ai/tool/builtin/writeable-tools.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

function clock(at = "2026-02-01T00:00:00Z"): FixedClock {
  return new FixedClock(new Date(at));
}

// ====== ProjectStatusVO ======

Deno.test("t1 — PROJECT_STATUSES 含 '中止'", () => {
  assert(PROJECT_STATUSES.includes("中止"), "PROJECT_STATUSES 应包含 '中止'");
});

Deno.test("t1 — 新建 → 中止 不合法（必须先经过提案中）", () => {
  const ps = ProjectStatus.create("新建");
  assert(ps.ok);
  if (!ps.ok) return;
  assertFalse(ps.value.canTransitionTo("中止"), "新建不能直接到中止");
});

Deno.test("t1 — 提案中 → 中止 合法", () => {
  const ps = ProjectStatus.create("提案中");
  assert(ps.ok);
  if (!ps.ok) return;
  assert(ps.value.canTransitionTo("中止"), "提案中可以到中止");
});

Deno.test("t1 — 暂停 → 中止 合法", () => {
  const ps = ProjectStatus.create("暂停");
  assert(ps.ok);
  if (!ps.ok) return;
  assert(ps.value.canTransitionTo("中止"), "暂停可以到中止");
});

Deno.test("t1 — 中止 是终态（无 outbound transition）", () => {
  const ps = ProjectStatus.create("中止");
  assert(ps.ok);
  if (!ps.ok) return;
  for (const target of PROJECT_STATUSES) {
    if (target === "中止") continue;
    assertFalse(
      ps.value.canTransitionTo(target),
      `中止不应跳到 ${target}`,
    );
  }
});

// ====== Project entity ======

function createProject(): Project {
  const r = Project.create({
    code: "TEST-001",
    name: "测试项目",
    clientName: "ACME",
    clock: clock(),
  });
  assert(r.ok, "create should succeed");
  if (!r.ok) throw new Error("unreachable");
  return r.value;
}

function advanceToProposal(p: Project): void {
  const c = clock();
  const r = p.changeStatus("提案中", c);
  assert(r.ok);
  if (!r.ok) return;
  p.pullDomainEvents();
}

Deno.test("t1 — Project.markWon 缺 bestPractice → INVALID_INPUT", () => {
  const p = createProject();
  advanceToProposal(p);
  const r = p.markWon({ wonDate: new Date("2026-06-15"), bestPractice: "" }, clock());
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("bestPractice"));
});

Deno.test("t1 — Project.markWon 合法 → 写入 wonDate + bestPractice", () => {
  const p = createProject();
  advanceToProposal(p);
  const r = p.markWon(
    { wonDate: new Date("2026-06-15"), bestPractice: "客户高层支持" },
    clock(),
  );
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(p.statusValue, "中标");
  assertEquals(p.snapshot().bestPractice, "客户高层支持");
});

Deno.test("t1 — Project.markLost 缺 improvementNote → INVALID_INPUT", () => {
  const p = createProject();
  advanceToProposal(p);
  const r = p.markLost(
    { lostDate: new Date("2026-07-01"), lostReason: "价格", improvementNote: "" },
    clock(),
  );
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("improvementNote"));
});

Deno.test("t1 — Project.markStopped 缺 stopReason → INVALID_INPUT", () => {
  const p = createProject();
  advanceToProposal(p);
  const r = p.markStopped(
    { pausedDate: new Date("2026-08-01"), stopReason: "  " },
    clock(),
  );
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("stopReason"));
});

Deno.test("t1 — Project.markStopped 缺 pausedDate → INVALID_INPUT", () => {
  const p = createProject();
  advanceToProposal(p);
  const r = p.markStopped(
    { pausedDate: new Date("invalid"), stopReason: "客户撤回" },
    clock(),
  );
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("pausedDate"));
});

Deno.test("t1 — Project.markStopped 合法 → 写入 pausedDate + pauseReason", () => {
  const p = createProject();
  advanceToProposal(p);
  const stopDate = new Date("2026-08-15T00:00:00Z");
  const r = p.markStopped({ pausedDate: stopDate, stopReason: "客户撤回预算" }, clock());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(p.statusValue, "中止");
  const snap = p.snapshot();
  assertEquals(snap.pausedDate?.toISOString(), stopDate.toISOString());
  assertEquals(snap.pauseReason, "客户撤回预算");
});

Deno.test("t1 — Project.markStopped 从暂停也可以走", () => {
  const p = createProject();
  advanceToProposal(p);
  const c = clock();
  p.markPaused({ pauseReason: "客户内审" }, c);
  const r = p.markStopped(
    { pausedDate: new Date("2026-08-20"), stopReason: "内部决策停止" },
    clock(),
  );
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(p.statusValue, "中止");
});

Deno.test("t1 — Project.markStopped 从新建拒绝（必须经过提案中/暂停）", () => {
  const p = createProject();
  const r = p.markStopped(
    { pausedDate: new Date("2026-08-15"), stopReason: "x" },
    clock(),
  );
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "ILLEGAL_STATE_TRANSITION");
});

// ====== ProjectService ======

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

async function setupService(): Promise<{
  svc: ProjectService;
  repo: SqliteProjectRepository;
  id: import("@shared/types/ids.ts").ProjectId;
}> {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const svc = new ProjectService({ repo, clock: clock() });
  const r = await svc.createProject({ name: "测试", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("unreachable");
  return { svc, repo, id: r.value.id };
}

Deno.test("t1 — ProjectService.changeProjectStatus → 中止 必填校验", async () => {
  const { svc, id } = await setupService();
  // 缺 pausedDate
  const r1 = await svc.changeProjectStatus(id, "中止", { stopReason: "x" });
  assertFalse(r1.ok);
  if (r1.ok) return;
  assertEquals(r1.error.code, "INVALID_INPUT");
  assert(r1.error.message.includes("pausedDate"));
  // 缺 stopReason
  const r2 = await svc.changeProjectStatus(id, "中止", {
    pausedDate: new Date("2026-12-01"),
  });
  assertFalse(r2.ok);
  if (r2.ok) return;
  assertEquals(r2.error.message.includes("stopReason"), true);
});

Deno.test("t1 — ProjectService.changeProjectStatus → 中止 合法路径", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const r = await svc.changeProjectStatus(id, "中止", {
    pausedDate: new Date("2026-12-01"),
    stopReason: "客户撤回",
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.status, "中止");
  assertEquals(r.value.pausedDate?.toISOString(), new Date("2026-12-01").toISOString());
  assertEquals(r.value.pauseReason, "客户撤回");
});

Deno.test("t1 — ProjectService.changeProjectStatus → 中标 必填 bestPractice", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const r = await svc.changeProjectStatus(id, "中标"); // 缺 bestPractice
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("bestPractice"));
});

Deno.test("t1 — ProjectService.changeProjectStatus → 未中标 必填 improvementNote", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const r = await svc.changeProjectStatus(id, "未中标", { reason: "价格" });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("improvementNote"));
});

// ====== writeable-tools ======

Deno.test("t1 — write_project_status 接受 status='中止'（schema enum 包含）", () => {
  const schema = new WriteProjectStatusTool({
    projectService: {} as never,
    projectRepo: {} as never,
    logger: makeLogger(),
  }).inputSchema;
  const statusProp = (schema.properties as Record<string, { enum: string[] }>).status;
  assert(statusProp.enum.includes("中止"), "inputSchema 应支持 status='中止'");
  assert(statusProp.enum.includes("新建"));
  assert(statusProp.enum.includes("提案中"));
  assert(statusProp.enum.includes("暂停"));
  assert(statusProp.enum.includes("中标"));
  assert(statusProp.enum.includes("未中标"));
});

Deno.test("t1 — write_project_status 缺 pausedDate → 失败", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const tool = new WriteProjectStatusTool({
    projectService: svc,
    projectRepo: (svc as unknown as { repo: SqliteProjectRepository }).repo,
    logger: makeLogger(),
  });
  const r = await tool.execute(
    { projectCodeOrName: "测试", status: "中止", stopReason: "客户撤回" },
    { logger: makeLogger(), cwd: Deno.cwd(), allowedPaths: [], timeoutMs: 1000 },
  );
  assertFalse(r.ok);
  if (r.ok) return;
  assert(r.error.includes("pausedDate"));
});