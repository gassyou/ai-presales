/**
 * BusinessModuleService — 应用层用例测试（用内存实现 IBusinessModuleRepository）
 *
 * 阶段 7.0。
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import type { IBusinessModuleRepository, ListByKindAcrossProjectsOptions } from "@backend/domain/business-module/business-module.repository.ts";
import type { BusinessModuleItemSnapshot } from "@backend/domain/business-module/business-module-item.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { SystemClock } from "@backend/domain/shared/clock.ts";
import { AdoptionStatus } from "@backend/domain/business-module/adoption-status.ts";

class InMemoryBusinessModuleRepository implements IBusinessModuleRepository {
  private readonly store = new Map<string, BusinessModuleItemSnapshot>();

  async save(item: BusinessModuleItemSnapshot): Promise<void> {
    this.store.set(item.id, { ...item, updatedAt: new Date() });
  }
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async listByProjectAndKind(
    projectId: ProjectId,
    kind: BusinessModuleKind,
    opts?: { status?: "pending" | "adopted" | "unadopted" },
  ) {
    return [...this.store.values()]
      .filter((s) => s.projectId === projectId && s.kind === kind)
      .filter((s) => !opts?.status || s.status === opts.status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async delete(id: string) {
    this.store.delete(id);
  }
  async countAdoptedByProjectAndKind(projectId: ProjectId, kind: BusinessModuleKind) {
    return [...this.store.values()].filter((s) =>
      s.projectId === projectId && s.kind === kind && s.status === "adopted"
    ).length;
  }
  async listByKindAcrossProjects(
    _kind: BusinessModuleKind,
    _opts: ListByKindAcrossProjectsOptions,
  ) {
    return [];
  }
}

const pid = crypto.randomUUID() as ProjectId;

Deno.test("BusinessModuleService.createItem — markdown_* 默认 adopted，结构化默认 pending", async () => {
  const svc = new BusinessModuleService({ repo: new InMemoryBusinessModuleRepository() });
  const md = await svc.createItem(pid, "markdown_proposal", { title: "方案草稿" });
  assert(md.ok);
  if (!md.ok) return;
  assertEquals(md.value.status, "adopted");

  const structured = await svc.createItem(pid, "activity", { title: "推进活动 1" });
  assert(structured.ok);
  if (!structured.ok) return;
  assertEquals(structured.value.status, "pending");
});

Deno.test("BusinessModuleService.listItems — 按 kind + status 过滤", async () => {
  const svc = new BusinessModuleService({ repo: new InMemoryBusinessModuleRepository() });
  await svc.createItem(pid, "activity", { title: "A1" });
  const b = await svc.createItem(pid, "activity", { title: "A2" });
  if (b.ok) await svc.adopt(b.value.id);

  const all = await svc.listItems(pid, "activity");
  assertEquals(all.length, 2);
  const adopted = await svc.listItems(pid, "activity", { status: "adopted" });
  assertEquals(adopted.length, 1);
  assertEquals(adopted[0].title, "A2");
});

Deno.test("BusinessModuleService.getItem / deleteItem", async () => {
  const svc = new BusinessModuleService({ repo: new InMemoryBusinessModuleRepository() });
  const created = await svc.createItem(pid, "review", { title: "Review A" });
  assert(created.ok);
  if (!created.ok) return;

  const got = await svc.getItem(created.value.id);
  assert(got.ok);
  assertEquals(got.value.title, "Review A");

  const deleted = await svc.deleteItem(created.value.id);
  assert(deleted.ok);

  const missing = await svc.getItem(created.value.id);
  assertFalse(missing.ok);
  assertEquals(missing.error.code, "NOT_FOUND");
});

Deno.test("BusinessModuleService.updateItem — 改 title/content/payload/status", async () => {
  const svc = new BusinessModuleService({ repo: new InMemoryBusinessModuleRepository() });
  const created = await svc.createItem(pid, "ppt", { title: "PPT 大纲" });
  assert(created.ok);
  if (!created.ok) return;

  const upd = await svc.updateItem(created.value.id, {
    title: "PPT v2",
    content: "# Section 1\n…",
    status: "adopted",
  });
  assert(upd.ok);
  if (!upd.ok) return;
  assertEquals(upd.value.title, "PPT v2");
  assertEquals(upd.value.status, "adopted");
});

Deno.test("BusinessModuleService.countAdopted — 只数 adopted", async () => {
  const svc = new BusinessModuleService({ repo: new InMemoryBusinessModuleRepository() });
  await svc.createItem(pid, "activity", { title: "x1" });
  const a = await svc.createItem(pid, "activity", { title: "x2" });
  if (a.ok) await svc.adopt(a.value.id);
  const b = await svc.createItem(pid, "activity", { title: "x3" });
  if (b.ok) await svc.adopt(b.value.id).then(() => svc.unadopt(b.value.id));

  const count = await svc.countAdopted(pid, "activity");
  assertEquals(count, 1);
});

Deno.test("AdoptionStatus.create — 拒绝未知值", () => {
  const r = AdoptionStatus.create("bogus");
  assertFalse(r.ok);
});
