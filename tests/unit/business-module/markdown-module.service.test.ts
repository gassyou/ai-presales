/**
 * MarkdownModuleService —— markdown_* 模块统一用例测试
 *
 * 阶段 7.3。
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import {
  MarkdownModuleService,
  moduleTitle,
} from "@backend/application/business-module/markdown-module.service.ts";
import type { IBusinessModuleRepository, ListByKindAcrossProjectsOptions } from "@backend/domain/business-module/business-module.repository.ts";
import type { BusinessModuleItemSnapshot } from "@backend/domain/business-module/business-module-item.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";

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

function newSvc() {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const repo = new InMemoryRepo();
  const bm = new BusinessModuleService({ repo, clock });
  return {
    svc: new MarkdownModuleService({ businessModuleService: bm, clock }),
    repo,
  };
}

const pid = crypto.randomUUID() as ProjectId;

Deno.test("get —— 项目下无 markdown 项返回 null", async () => {
  const { svc } = newSvc();
  const r = await svc.get(pid, "markdown_business_current");
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value, null);
});

Deno.test("getOrInit —— 不存在则用模板创建", async () => {
  const { svc } = newSvc();
  const r = await svc.getOrInit(pid, "markdown_pain_point");
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.kind, "markdown_pain_point");
  assertEquals(r.value.title, "现状问题点 / 痛点");
  assertStringIncludes(r.value.content, "现状问题点 / 痛点");
  assertStringIncludes(r.value.content, "业务痛点");
  // markdown 默认 adopted
  assertEquals(r.value.status, "adopted");
});

Deno.test("getOrInit —— 第二次调用返回同一条，不创建新记录", async () => {
  const { svc, repo } = newSvc();
  const a = await svc.getOrInit(pid, "markdown_improvement");
  assert(a.ok);
  if (!a.ok) return;
  const beforeCount = (await repo.listByProjectAndKind(pid, "markdown_improvement")).length;
  const b = await svc.getOrInit(pid, "markdown_improvement");
  assert(b.ok);
  if (!b.ok) return;
  assertEquals(b.value.id, a.value.id);
  const afterCount = (await repo.listByProjectAndKind(pid, "markdown_improvement")).length;
  assertEquals(afterCount, beforeCount);
});

Deno.test("saveContent —— 更新内容", async () => {
  const { svc } = newSvc();
  const a = await svc.getOrInit(pid, "markdown_proposal");
  assert(a.ok);
  if (!a.ok) return;
  const upd = await svc.saveContent(a.value.id, "# 新方案\n…");
  assert(upd.ok);
  if (!upd.ok) return;
  assertEquals(upd.value.content, "# 新方案\n…");
});

Deno.test("generateContent —— 用模板覆盖（含生成时间戳）", async () => {
  const { svc } = newSvc();
  const r = await svc.generateContent(pid, "markdown_roi");
  assert(r.ok);
  if (!r.ok) return;
  assertStringIncludes(r.value.content, "ROI 分析");
  assertStringIncludes(r.value.content, "生成时间");
  // 阶段 7.5（H4）：未注入 invokeSubAgent → 走模板占位（不再写「占位逻辑」字样）
});

Deno.test("generateContent —— 注入 invokeSubAgent：内容来自 LLM（markdown_business_current → survey-researcher）", async () => {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const repo = new InMemoryRepo();
  const bm = new BusinessModuleService({ repo, clock });
  const fakeStream = (async function* () {
    yield { type: "chunk" as const, delta: "# 业务现状（LLM 输出）\n\n", messageId: "m1" };
    yield { type: "chunk" as const, delta: "由 markdown-author 生成", messageId: "m1" };
    yield { type: "done" as const, messageId: "m1", usage: { inputTokens: 0, outputTokens: 10, totalTokens: 10 } };
  })();
  const invokeSubAgent = (
    _name: string,
    _input: string,
    _opts?: { signal?: AbortSignal },
  ): AsyncIterable<{ type: string; [k: string]: unknown }> => fakeStream;
  const svc = new MarkdownModuleService({
    businessModuleService: bm,
    clock,
    invokeSubAgent: invokeSubAgent as never,
  });
  const r = await svc.generateContent(pid, "markdown_business_current");
  assert(r.ok);
  if (!r.ok) return;
  assertStringIncludes(r.value.content, "由 markdown-author 生成");
  assertStringIncludes(r.value.content, "生成时间");
});

Deno.test("generateContent —— LLM 抛错时降级到模板 + 错误提示", async () => {
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const repo = new InMemoryRepo();
  const bm = new BusinessModuleService({ repo, clock });
  const failingStream = (async function* () {
    yield { type: "error" as const, code: "PROVIDER_DOWN", message: "LLM unavailable", messageId: "m1" };
  })();
  const invokeSubAgent = (
    _name: string,
    _input: string,
  ): AsyncIterable<{ type: string; [k: string]: unknown }> => failingStream;
  const svc = new MarkdownModuleService({
    businessModuleService: bm,
    clock,
    invokeSubAgent: invokeSubAgent as never,
  });
  const r = await svc.generateContent(pid, "markdown_roi");
  assert(r.ok);
  if (!r.ok) return;
  // 降级到模板 + 错误提示
  assertStringIncludes(r.value.content, "ROI 分析");
  assertStringIncludes(r.value.content, "AI 生成失败");
});

Deno.test("setAdoption —— adopt / unadopt 切换", async () => {
  const { svc } = newSvc();
  const a = await svc.getOrInit(pid, "markdown_business_current");
  assert(a.ok);
  if (!a.ok) return;
  // 默认 adopted，再 adopt noop
  const adopt = await svc.setAdoption(a.value.id, true);
  assert(adopt.ok);
  assertEquals(adopt.value.status, "adopted");
  const unadopt = await svc.setAdoption(a.value.id, false);
  assert(unadopt.ok);
  assertEquals(unadopt.value.status, "unadopted");
});

Deno.test("get / getOrInit —— 非 markdown kind → INVALID_INPUT", async () => {
  const { svc } = newSvc();
  const r1 = await svc.get(pid, "activity");
  assertFalse(r1.ok);
  if (r1.ok) return;
  assertEquals(r1.error.code, "INVALID_INPUT");

  const r2 = await svc.getOrInit(pid, "function_list");
  assertFalse(r2.ok);
  if (r2.ok) return;
  assertEquals(r2.error.code, "INVALID_INPUT");
});

Deno.test("moduleTitle —— 11 个 markdown kind 都映射到中文标题", () => {
  const expected = [
    ["markdown_business_current", "业务现状"],
    ["markdown_pain_point", "现状问题点 / 痛点"],
    ["markdown_improvement", "改善目标"],
    ["markdown_proposal", "构想方案"],
    ["markdown_non_functional", "非功能需求"],
    ["markdown_it_environment", "IT/技术环境"],
    ["markdown_risk", "风险分析"],
    ["markdown_to_be", "TO-BE 蓝图"],
    ["markdown_roi", "ROI 分析"],
    ["markdown_precondition", "案件前提条件"],
    ["markdown_hardware_cost", "硬件设备成本"],
  ] as const;
  for (const [kind, title] of expected) {
    assertEquals(moduleTitle(kind), title);
  }
});
