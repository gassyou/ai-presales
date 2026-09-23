/**
 * StructuredModulesUseCase 单元测试
 *
 * 阶段 7.4a。覆盖：用例 / 交付物 / Review 三模块的 CRUD + summary + weightedScore。
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import {
  makeReviewPayload,
  weightedScore,
} from "@backend/domain/business-module/review.ts";
import { ProjectId } from "@shared/types/ids.ts";

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

async function setup(): Promise<{ pid: ProjectId; uc: StructuredModulesUseCase }> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "sm-uc", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  return { pid: r.value.id, uc: new StructuredModulesUseCase(bmSvc) };
}

Deno.test("UseCase — create + list + update + delete", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.createUseCase(pid, {
    title: "订单创建",
    detail: "用户提交订单并扣减库存",
    caseId: "UC-001",
    businessRules: "需要校验用户实名",
  });
  assert(r1.ok);
  if (!r1.ok) throw new Error("create");
  assertEquals(r1.value.title, "订单创建");
  assertEquals(r1.value.caseId, "UC-001");

  const list = await uc.listUseCases(pid);
  assertEquals(list.length, 1);
  assertEquals(list[0]!.id, r1.value.id);

  const u1 = await uc.updateUseCase(r1.value.id, {
    title: "订单创建 v2",
    businessRules: "需要校验用户实名 + 信用",
  });
  assert(u1.ok);
  if (!u1.ok) throw new Error("update");
  assertEquals(u1.value.title, "订单创建 v2");
  assertEquals(u1.value.caseId, "UC-001", "未传 caseId 不应被清空");
  assertEquals(u1.value.businessRules, "需要校验用户实名 + 信用");

  const del = await uc.deleteUseCase(r1.value.id);
  assert(del.ok);
  const list2 = await uc.listUseCases(pid);
  assertEquals(list2.length, 0);
});

Deno.test("UseCase — 空标题拒绝", async () => {
  const { pid, uc } = await setup();
  const r = await uc.createUseCase(pid, { title: "  " });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("Deliverable — create + status 切换", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.createDeliverable(pid, {
    title: "需求说明书",
    type: "文档",
    owner: "张三",
    status: "not_started",
  });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  assertEquals(r1.value.status, "not_started");
  assertEquals(r1.value.type, "文档");

  const u1 = await uc.updateDeliverable(r1.value.id, { status: "in_progress" });
  assert(u1.ok);
  if (!u1.ok) throw new Error();
  assertEquals(u1.value.status, "in_progress");
  assertEquals(u1.value.owner, "张三", "未传 owner 不应清空");

  // 清空 owner（传空串应保留 → 应当前实现保留原值）
  const u2 = await uc.updateDeliverable(r1.value.id, { owner: "李四" });
  assert(u2.ok);
  if (!u2.ok) throw new Error();
  assertEquals(u2.value.owner, "李四");

  const list = await uc.listDeliverables(pid);
  assertEquals(list.length, 1);
});

Deno.test("Deliverable — dueDate 持久化", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.createDeliverable(pid, {
    title: "交付",
    dueDate: "2026-12-31",
  });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  assertEquals(r1.value.dueDate, "2026-12-31");
});

Deno.test("Review — create + weightedScore 计算", async () => {
  const { pid, uc } = await setup();
  await uc.createReview(pid, {
    title: "业务价值",
    dimension: "业务价值",
    score: 8,
    weight: 0.4,
    comment: "高",
  });
  await uc.createReview(pid, {
    title: "技术可行性",
    dimension: "技术可行性",
    score: 6,
    weight: 0.3,
    comment: "中",
  });
  await uc.createReview(pid, {
    title: "成本",
    dimension: "成本合理性",
    score: 5,
    weight: 0.3,
    comment: "略高",
  });

  const items = await uc.listReviews(pid);
  assertEquals(items.length, 3);

  const summary = await uc.reviewSummary(pid);
  assert(summary.ok);
  if (!summary.ok) throw new Error();
  assertEquals(summary.value.itemCount, 3);
  // 加权：(8*0.4 + 6*0.3 + 5*0.3) / (0.4 + 0.3 + 0.3) = (3.2+1.8+1.5)/1 = 6.5
  assertEquals(Math.round(summary.value.totalScore * 1000), 6500);
});

Deno.test("Review — 空列表汇总为 0", async () => {
  const { pid, uc } = await setup();
  const s = await uc.reviewSummary(pid);
  assert(s.ok);
  if (!s.ok) throw new Error();
  assertEquals(s.value.totalScore, 0);
  assertEquals(s.value.itemCount, 0);
});

Deno.test("Review — weightedScore 纯函数", () => {
  const items = [
    makeReviewPayload({ score: 10, weight: 1 }),
    makeReviewPayload({ score: 0, weight: 1 }),
  ];
  // (10 + 0) / 2 = 5
  assertEquals(weightedScore(items), 5);
  // 空
  assertEquals(weightedScore([]), 0);
  // 单条
  assertEquals(weightedScore([makeReviewPayload({ score: 7, weight: 0.5 })]), 7);
});

Deno.test("Review — 缺 dimension 拒绝", async () => {
  const { pid, uc } = await setup();
  const r = await uc.createReview(pid, { title: "t", dimension: "" });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("三种模块独立 — 不串", async () => {
  const { pid, uc } = await setup();
  await uc.createUseCase(pid, { title: "UC" });
  await uc.createDeliverable(pid, { title: "DL" });
  await uc.createReview(pid, { title: "RV", dimension: "x" });
  assertEquals((await uc.listUseCases(pid)).length, 1);
  assertEquals((await uc.listDeliverables(pid)).length, 1);
  assertEquals((await uc.listReviews(pid)).length, 1);
});

// 阶段 7.5（H1）：batchFromSubAgent 真调 LLM 路径
Deno.test("StructuredModulesUseCase.batchFromSubAgent —— 未注入 invokeSubAgent 返 NOT_IMPLEMENTED", async () => {
  const { pid, uc } = await setup();
  const r = await uc.batchFromSubAgent(pid, { count: 3 });
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "NOT_IMPLEMENTED");
});

Deno.test("StructuredModulesUseCase.batchFromSubAgent —— 注入 invokeSubAgent：JSON 解析成功后逐条 createFunction", async () => {
  const { pid, uc } = await setup();
  const fakeStream = (async function* () {
    const json = JSON.stringify([
      { category: "订单", module: "下单", name: "提交订单", cp: 5, inScope: true, detail: "d1" },
      { category: "订单", module: "支付", name: "支付回调", cp: 8, inScope: true, detail: "d2" },
    ]);
    yield { type: "chunk" as const, delta: json, messageId: "m1" };
    yield { type: "done" as const, messageId: "m1", usage: { inputTokens: 0, outputTokens: 10, totalTokens: 10 } };
  })();
  const invokeSubAgent = (
    _name: string,
    _input: string,
  ): AsyncIterable<{ type: string; [k: string]: unknown }> => fakeStream;
  const wired = new StructuredModulesUseCase({
    bm: (uc as unknown as { bm: BusinessModuleService }).bm,
    invokeSubAgent: invokeSubAgent as never,
  });
  const r = await wired.batchFromSubAgent(pid, { count: 2 });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.created.length, 2);
  assertStringIncludes(r.value.created[0]!.name, "提交订单");
});

Deno.test("StructuredModulesUseCase.batchFromSubAgent —— LLM 返坏 JSON 时降级到 placeholder 行", async () => {
  const { pid, uc } = await setup();
  const fakeStream = (async function* () {
    yield { type: "chunk" as const, delta: "这不是 JSON", messageId: "m1" };
    yield { type: "done" as const, messageId: "m1", usage: { inputTokens: 0, outputTokens: 1, totalTokens: 1 } };
  })();
  const invokeSubAgent = (
    _name: string,
    _input: string,
  ): AsyncIterable<{ type: string; [k: string]: unknown }> => fakeStream;
  const wired = new StructuredModulesUseCase({
    bm: (uc as unknown as { bm: BusinessModuleService }).bm,
    invokeSubAgent: invokeSubAgent as never,
  });
  const r = await wired.batchFromSubAgent(pid, { count: 2 });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.created.length, 2);
  // fallback 行的 name 形如「（待补充功能 N）」
  assertStringIncludes(r.value.created[0]!.name, "待补充功能");
});
