/**
 * 任务 1：项目状态机测试
 *
 * 覆盖：
 *   - ProjectStatusVO 5 态 + transition 规则（暂停 → 中标/未中标 单向）
 *   - Project.markWon.bestPractice 必填
 *   - Project.markLost.improvementNote 必填
 *   - Project.markPaused 必填 pauseReason + pausedDate
 *   - ProjectService.changeProjectStatus 中标/未中标/暂停 路由
 *   - writeable-tools 中 write_project_status 5 态
 *
 * 注："恢复"功能已移除（markResumed / resumeProject / ResumeProjectTool 全部撤回）。
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

Deno.test("t1 — PROJECT_STATUSES 是 5 态且不含 '中止'", () => {
  assertEquals(PROJECT_STATUSES.length, 5);
  assert(PROJECT_STATUSES.includes("新建"));
  assert(PROJECT_STATUSES.includes("提案中"));
  assert(PROJECT_STATUSES.includes("暂停"));
  assert(PROJECT_STATUSES.includes("中标"));
  assert(PROJECT_STATUSES.includes("未中标"));
  assertFalse(
    (PROJECT_STATUSES as readonly string[]).includes("中止"),
    "PROJECT_STATUSES 不应包含 '中止'",
  );
});

Deno.test("t1 — 提案中 → 暂停 合法；暂停 → 提案中 不再合法（单向）", () => {
  const ps1 = ProjectStatus.create("提案中");
  assert(ps1.ok);
  if (!ps1.ok) return;
  assert(ps1.value.canTransitionTo("暂停"));

  // "恢复"功能已移除：暂停是单向流程，只能走 中标/未中标 终态。
  const ps2 = ProjectStatus.create("暂停");
  assert(ps2.ok);
  if (!ps2.ok) return;
  assertFalse(ps2.value.canTransitionTo("提案中"));
  assert(ps2.value.canTransitionTo("中标"));
  assert(ps2.value.canTransitionTo("未中标"));
});

Deno.test("t1 — 中标/未中标 是终态（无 outbound）", () => {
  for (const s of ["中标", "未中标"] as const) {
    const ps = ProjectStatus.create(s);
    assert(ps.ok);
    if (!ps.ok) return;
    for (const target of PROJECT_STATUSES) {
      if (target === s) continue;
      assertFalse(ps.value.canTransitionTo(target), `${s} 不应跳到 ${target}`);
    }
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

Deno.test("t1 — Project.markPaused 缺 pauseReason → INVALID_INPUT", () => {
  const p = createProject();
  advanceToProposal(p);
  const c = clock();
  const r = p.markPaused({ pauseReason: "  ", pausedDate: new Date("2026-03-15") }, c);
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("pauseReason"));
});

Deno.test("t1 — Project.markPaused pausedDate 是 Invalid Date → INVALID_INPUT", () => {
  const p = createProject();
  advanceToProposal(p);
  const c = clock("2026-03-15T10:00:00Z");
  // 运行时校验 pausedDate 必须是合法 Date —— 用 Invalid Date 模拟
  const r = p.markPaused({ pauseReason: "客户内审", pausedDate: new Date("not-a-date") }, c);
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("pausedDate"));
});

Deno.test("t1 — Project.markPaused 合法 → 写入 pausedDate + pauseReason", () => {
  const p = createProject();
  advanceToProposal(p);
  const c = clock("2026-03-15T10:00:00Z");
  const pausedDate = new Date("2026-03-15T08:00:00Z");
  const r = p.markPaused({ pauseReason: "客户内审", pausedDate }, c);
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(p.statusValue, "暂停");
  const snap = p.snapshot();
  assertEquals(snap.pauseReason, "客户内审");
  assertEquals(snap.pausedDate?.toISOString(), pausedDate.toISOString());
});

Deno.test("t1 — Project.markPaused 从新建直接 → 暂停 合法", () => {
  // 状态机放宽：新建可直接跳到 暂停/中标/未中标
  const p = createProject();
  // 默认就是 "新建"
  const r = p.markPaused(
    { pauseReason: "客户内审", pausedDate: new Date("2026-03-15") },
    clock(),
  );
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(p.statusValue, "暂停");
});

Deno.test("t1 — Project.markPaused 从中标 → 暂停 拒绝（中标是终态）", () => {
  const p = createProject();
  advanceToProposal(p);
  p.markWon(
    { wonDate: new Date("2026-06-15"), bestPractice: "x" },
    clock(),
  );
  assertEquals(p.statusValue, "中标");
  const r = p.markPaused(
    { pauseReason: "x", pausedDate: new Date("2026-03-15") },
    clock(),
  );
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "ILLEGAL_STATE_TRANSITION");
});

// 注："恢复"功能已移除——markResumed / resumeProject / ResumeProjectTool 全部撤回。
// 暂停是单向流程，暂停后只能走向 中标/未中标 终态。

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

Deno.test("t1 — ProjectService.changeProjectStatus → 暂停 缺 reason → 失败", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const r = await svc.changeProjectStatus(id, "暂停", {
    pausedDate: new Date("2026-03-15"),
  });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("pauseReason"));
});

Deno.test("t1 — ProjectService.changeProjectStatus → 暂停 缺 pausedDate → 失败", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const r = await svc.changeProjectStatus(id, "暂停", { reason: "客户内审" });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("pausedDate"));
});

Deno.test("t1 — ProjectService.changeProjectStatus → 暂停 合法", async () => {
  const { svc, id } = await setupService();
  await svc.changeProjectStatus(id, "提案中");
  const r = await svc.changeProjectStatus(id, "暂停", {
    reason: "客户内审",
    pausedDate: new Date("2026-03-15T10:00:00Z"),
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.status, "暂停");
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

Deno.test("t1 — write_project_status 接受 5 态（schema enum 不含中止）", () => {
  const schema = new WriteProjectStatusTool({
    projectService: {} as never,
    projectRepo: {} as never,
    logger: makeLogger(),
  }).inputSchema;
  const statusProp = (schema.properties as unknown as Record<string, { enum: string[] }>).status;
  assertEquals(statusProp.enum.length, 5);
  assert(statusProp.enum.includes("新建"));
  assert(statusProp.enum.includes("提案中"));
  assert(statusProp.enum.includes("暂停"));
  assert(statusProp.enum.includes("中标"));
  assert(statusProp.enum.includes("未中标"));
  assertFalse(statusProp.enum.includes("中止"));
});
