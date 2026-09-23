/**
 * SurveyQuestionnaireUseCase —— 调查问卷用例测试
 *
 * 阶段 7.2。用内存仓储模拟。
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import type { IBusinessModuleRepository, ListByKindAcrossProjectsOptions } from "@backend/domain/business-module/business-module.repository.ts";
import type { BusinessModuleItemSnapshot } from "@backend/domain/business-module/business-module-item.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { flattenMindmap, type MindmapNode } from "@backend/domain/business-module/survey-questionnaire.ts";

class InMemoryRepo implements IBusinessModuleRepository {
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
  async countAdoptedByProjectAndKind(_p: ProjectId, _k: BusinessModuleKind) {
    return 0;
  }
  async listByKindAcrossProjects(
    _kind: BusinessModuleKind,
    _opts: ListByKindAcrossProjectsOptions,
  ) {
    return [];
  }
}

function newUseCase() {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const repo = new InMemoryRepo();
  const bm = new BusinessModuleService({ repo, clock });
  return { useCase: new SurveyQuestionnaireUseCase({ businessModuleService: bm, clock }), repo };
}

const pid = crypto.randomUUID() as ProjectId;

const sampleMindmap: MindmapNode = {
  id: "root",
  text: "客户满意度",
  children: [
    { id: "n1", text: "产品功能", children: [
      { id: "n1a", text: "功能完备性", children: [] },
      { id: "n1b", text: "易用性", children: [] },
    ]},
    { id: "n2", text: "服务质量", children: [
      { id: "n2a", text: "响应及时性", children: [] },
    ]},
  ],
};

Deno.test("getOutline —— 项目下无大纲返回 null", async () => {
  const { useCase } = newUseCase();
  const r = await useCase.getOutline(pid);
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value, null);
});

Deno.test("saveOutline —— 第一次创建大纲", async () => {
  const { useCase } = newUseCase();
  const r = await useCase.saveOutline(pid, sampleMindmap);
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.mindmap?.text, "客户满意度");
  assertEquals(r.value.mindmap?.children.length, 2);
});

Deno.test("saveOutline —— 第二次更新（不创建新 item）", async () => {
  const { useCase, repo } = newUseCase();
  const a = await useCase.saveOutline(pid, sampleMindmap);
  assert(a.ok);
  if (!a.ok) return;
  const before = repo.findById(a.value.id) as Promise<BusinessModuleItemSnapshot | null>;
  const snap = await before;
  assert(snap);
  const newMap: MindmapNode = { id: "r2", text: "新主题", children: [] };
  const b = await useCase.saveOutline(pid, newMap);
  assert(b.ok);
  if (!b.ok) return;
  // 同一个 item id
  assertEquals(b.value.id, a.value.id);
  assertEquals(b.value.mindmap?.text, "新主题");
});

Deno.test("upsertQuestionInProject —— 创建问题并 list", async () => {
  const { useCase } = newUseCase();
  const o = await useCase.saveOutline(pid, sampleMindmap);
  assert(o.ok);
  if (!o.ok) return;
  const q1 = await useCase.upsertQuestionInProject(pid, {
    parentId: o.value.id,
    ordinal: 0,
    title: "功能是否满足需求？",
    outlinePath: "客户满意度 / 产品功能",
  });
  assert(q1.ok);
  if (!q1.ok) return;
  assertEquals(q1.value.title, "功能是否满足需求？");
  assertEquals(q1.value.outlinePath, "客户满意度 / 产品功能");

  const q2 = await useCase.upsertQuestionInProject(pid, {
    parentId: o.value.id,
    ordinal: 1,
    title: "响应是否及时？",
    outlinePath: "客户满意度 / 服务质量",
  });
  assert(q2.ok);

  const list = await useCase.listQuestions(o.value.id);
  assert(list.ok);
  if (!list.ok) return;
  assertEquals(list.value.length, 2);
  assertEquals(list.value[0]!.title, "功能是否满足需求？");
  assertEquals(list.value[1]!.title, "响应是否及时？");
});

Deno.test("upsertQuestionInProject —— 更新已有问题（questionId 路径）", async () => {
  const { useCase } = newUseCase();
  const o = await useCase.saveOutline(pid, sampleMindmap);
  assert(o.ok);
  if (!o.ok) return;
  const q = await useCase.upsertQuestionInProject(pid, {
    parentId: o.value.id,
    ordinal: 0,
    title: "原标题",
  });
  assert(q.ok);
  if (!q.ok) return;
  const upd = await useCase.upsertQuestionInProject(pid, {
    questionId: q.value.id,
    parentId: o.value.id,
    ordinal: 0,
    title: "新标题",
  });
  assert(upd.ok);
  if (!upd.ok) return;
  assertEquals(upd.value.id, q.value.id);
  assertEquals(upd.value.title, "新标题");
});

Deno.test("deleteQuestion —— 删除后 list 减少", async () => {
  const { useCase } = newUseCase();
  const o = await useCase.saveOutline(pid, sampleMindmap);
  assert(o.ok);
  if (!o.ok) return;
  const q1 = await useCase.upsertQuestionInProject(pid, { parentId: o.value.id, ordinal: 0, title: "A" });
  const q2 = await useCase.upsertQuestionInProject(pid, { parentId: o.value.id, ordinal: 1, title: "B" });
  assert(q1.ok && q2.ok);
  if (!q1.ok || !q2.ok) return;
  await useCase.deleteQuestion(q1.value.id);
  const list = await useCase.listQuestions(o.value.id);
  assert(list.ok);
  if (!list.ok) return;
  assertEquals(list.value.length, 1);
  assertEquals(list.value[0]!.title, "B");
});

Deno.test("batchFromMindmap —— 展开脑图生成问题", async () => {
  const { useCase } = newUseCase();
  const o = await useCase.saveOutline(pid, sampleMindmap);
  assert(o.ok);
  if (!o.ok) return;
  const r = await useCase.batchFromMindmap(o.value.id);
  assert(r.ok);
  if (!r.ok) return;
  // sampleMindmap: root, n1, n1a, n1b, n2, n2a = 6 个节点
  assertEquals(r.value.length, 6);
  // ordinal 递增
  for (let i = 0; i < r.value.length; i++) {
    assertEquals(r.value[i]!.ordinal, i);
  }
});

Deno.test("saveAnswer —— 保存回答并可重新读取", async () => {
  const { useCase } = newUseCase();
  const o = await useCase.saveOutline(pid, sampleMindmap);
  assert(o.ok);
  if (!o.ok) return;
  const q = await useCase.upsertQuestionInProject(pid, { parentId: o.value.id, ordinal: 0, title: "Q" });
  assert(q.ok);
  if (!q.ok) return;
  const saved = await useCase.saveAnswer(q.value.id, "这是我的回答");
  assert(saved.ok);
  if (!saved.ok) return;
  assertEquals(saved.value.answer, "这是我的回答");
});

Deno.test("upsertQuestionInProject —— 空标题拒绝", async () => {
  const { useCase } = newUseCase();
  const o = await useCase.saveOutline(pid, sampleMindmap);
  assert(o.ok);
  if (!o.ok) return;
  const r = await useCase.upsertQuestionInProject(pid, {
    parentId: o.value.id,
    ordinal: 0,
    title: "   ",
  });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("flattenMindmap —— 空脑图返回空数组", () => {
  assertEquals(flattenMindmap(null).length, 0);
});

Deno.test("flattenMindmap —— 包含根节点与所有后代", () => {
  const flat = flattenMindmap(sampleMindmap);
  assertEquals(flat.length, 6);
  assertStringIncludes(flat[0]!.path, "客户满意度");
  const n1a = flat.find((x) => x.node.id === "n1a");
  assert(n1a);
  assertStringIncludes(n1a.path, "产品功能");
});
