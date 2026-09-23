/**
 * SurveyTaskUseCase —— 调查任务专用用例测试
 *
 * 阶段 7.1。用内存仓储模拟；simulateDurationMs=20ms 加速测试。
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import type { IBusinessModuleRepository, ListByKindAcrossProjectsOptions } from "@backend/domain/business-module/business-module.repository.ts";
import type { BusinessModuleItemSnapshot } from "@backend/domain/business-module/business-module-item.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { SURVEY_TASK_KIND, parseSurveyTaskPayload } from "@backend/domain/business-module/survey-task.ts";

class InMemoryBusinessModuleRepository implements IBusinessModuleRepository {
  private readonly store = new Map<string, BusinessModuleItemSnapshot>();
  async save(item: BusinessModuleItemSnapshot) {
    this.store.set(item.id, { ...item, updatedAt: new Date() });
  }
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async listByProjectAndKind(
    projectId: ProjectId,
    kind: BusinessModuleKind,
  ) {
    return [...this.store.values()]
      .filter((s) => s.projectId === projectId && s.kind === kind)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async delete(id: string) {
    this.store.delete(id);
  }
  async countAdoptedByProjectAndKind(_projectId: ProjectId, _kind: BusinessModuleKind) {
    return 0;
  }
  async listByKindAcrossProjects(
    _kind: BusinessModuleKind,
    _opts: ListByKindAcrossProjectsOptions,
  ) {
    return [];
  }
}

function newSvc() {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const repo = new InMemoryBusinessModuleRepository();
  const bm = new BusinessModuleService({ repo, clock });
  const useCase = new SurveyTaskUseCase({
    businessModuleService: bm,
    clock,
    simulateDurationMs: 20,
  });
  return { useCase, repo, clock };
}

const pid = crypto.randomUUID() as ProjectId;

Deno.test("SurveyTaskUseCase.create —— 默认 taskStatus=idle", async () => {
  const { useCase } = newSvc();
  const r = await useCase.create(pid, "客户背景信息调查", "请调查该客户的年度营业额等");
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.title, "客户背景信息调查");
  assertEquals(r.value.taskStatus, "idle");
  assertEquals(r.value.adoptionStatus, "pending");
  assertEquals(r.value.resultContent, "请调查该客户的年度营业额等");
});

Deno.test("SurveyTaskUseCase.start —— 异步完成后 taskStatus=completed", async () => {
  const { useCase } = newSvc();
  const c = await useCase.create(pid, "行业背景信息", "");
  assert(c.ok);
  if (!c.ok) return;
  const s = await useCase.start(c.value.id);
  assert(s.ok);
  if (!s.ok) return;
  assertEquals(s.value.taskStatus, "running");
  // 等待异步完成
  await new Promise((res) => setTimeout(res, 60));
  const after = await useCase.get(c.value.id);
  assert(after.ok);
  if (!after.ok) return;
  assertEquals(after.value.taskStatus, "completed");
  assertStringIncludes(after.value.resultContent, "调查：行业背景信息");
});

Deno.test("SurveyTaskUseCase.stop —— 终止后 taskStatus=aborted", async () => {
  const { useCase } = newSvc();
  const c = await useCase.create(pid, "X", "");
  assert(c.ok);
  if (!c.ok) return;
  await useCase.start(c.value.id);
  const stop = await useCase.stop(c.value.id);
  assert(stop.ok);
  if (!stop.ok) return;
  assertEquals(stop.value.taskStatus, "aborted");
});

Deno.test("SurveyTaskUseCase.delete —— 取消进行中的任务", async () => {
  const { useCase } = newSvc();
  const c = await useCase.create(pid, "X", "");
  assert(c.ok);
  if (!c.ok) return;
  await useCase.start(c.value.id);
  const del = await useCase.delete(c.value.id);
  assert(del.ok);
  const after = await useCase.get(c.value.id);
  assertFalse(after.ok);
});

Deno.test("SurveyTaskUseCase.batchGenerate —— 一次性创建多条 idle 任务", async () => {
  const { useCase } = newSvc();
  const r = await useCase.batchGenerate(pid, ["客户背景", "行业背景", "技术趋势"], { autoStart: false });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.length, 3);
  for (const t of r.value) {
    assertEquals(t.taskStatus, "idle");
  }
});

Deno.test("SurveyTaskUseCase.start —— 注入 invokeSubAgent：完成后内容来自 LLM", async () => {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const repo = new InMemoryBusinessModuleRepository();
  const bm = new BusinessModuleService({ repo, clock });
  const fakeStream = (async function* () {
    yield { type: "chunk" as const, delta: "# 真实调研\n\n", messageId: "m1" };
    yield { type: "chunk" as const, delta: "由 proposal-drafter 输出", messageId: "m1" };
    yield { type: "done" as const, messageId: "m1", usage: { inputTokens: 0, outputTokens: 10, totalTokens: 10 } };
  })();
  const invokeSubAgent = (
    _name: string,
    _input: string,
    _opts?: { signal?: AbortSignal },
  ): AsyncIterable<{ type: string; [k: string]: unknown }> => fakeStream;
  const useCase = new SurveyTaskUseCase({
    businessModuleService: bm,
    clock,
    invokeSubAgent: invokeSubAgent as never,
  });
  const c = await useCase.create(pid, "客户背景", "");
  assert(c.ok);
  if (!c.ok) return;
  await useCase.start(c.value.id);
  // 等 background 完成
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const got = await useCase.get(c.value.id);
    if (got.ok && got.value.taskStatus === "completed") break;
  }
  const got = await useCase.get(c.value.id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.taskStatus, "completed");
  assertStringIncludes(got.value.resultContent, "由 proposal-drafter 输出");
});

Deno.test("SurveyTaskUseCase.start —— 重复 start 第二次返回错误", async () => {
  const { useCase } = newSvc();
  const c = await useCase.create(pid, "X", "");
  assert(c.ok);
  if (!c.ok) return;
  const s1 = await useCase.start(c.value.id);
  assert(s1.ok);
  const s2 = await useCase.start(c.value.id);
  assertFalse(s2.ok);
  if (s2.ok) return;
  assertEquals(s2.error.code, "ILLEGAL_STATE_TRANSITION");
  await useCase.stop(c.value.id);
});

Deno.test("parseSurveyTaskPayload —— 容忍损坏 JSON", () => {
  const p = parseSurveyTaskPayload("not-json");
  assertEquals(p.taskStatus, "idle");
  const p2 = parseSurveyTaskPayload(JSON.stringify({ taskStatus: "completed", topicHint: "abc" }));
  assertEquals(p2.taskStatus, "completed");
  assertEquals(p2.topicHint, "abc");
});

Deno.test("SURVEY_TASK_KIND —— 等于 survey_task 枚举", () => {
  assertEquals(SURVEY_TASK_KIND, "survey_task");
});
