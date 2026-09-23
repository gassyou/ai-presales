/**
 * BusinessModuleItem 聚合根 — 单元测试
 *
 * 阶段 7.0。
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { SystemClock } from "@backend/domain/shared/clock.ts";
import { BusinessModuleItem } from "@backend/domain/business-module/business-module-item.ts";
import { ProjectId } from "@shared/types/ids.ts";
import { AdoptionStatus } from "@backend/domain/business-module/adoption-status.ts";

function newProjectId(): ProjectId {
  return crypto.randomUUID() as ProjectId;
}

Deno.test("BusinessModuleItem.create — 接受有效 title，返回初始状态", () => {
  const pid = newProjectId();
  const clock = new SystemClock();
  const r = BusinessModuleItem.create({
    projectId: pid,
    kind: "activity",
    title: "客户访谈",
    clock,
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.title, "客户访谈");
  assertEquals(r.value.status, "pending");
  assertEquals(r.value.kind, "activity");
  assertEquals(r.value.projectId, pid);
  assertEquals(r.value.content, "");
  assertEquals(r.value.payloadJson, "{}");
});

Deno.test("BusinessModuleItem.create — 空 title 拒绝", () => {
  const r = BusinessModuleItem.create({
    projectId: newProjectId(),
    kind: "activity",
    title: "   ",
    clock: new SystemClock(),
  });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("BusinessModuleItem.update — 改 title/content/payload 后 updatedAt 推进", async () => {
  const clock = new SystemClock();
  const r = BusinessModuleItem.create({
    projectId: newProjectId(),
    kind: "markdown_proposal",
    title: "初始标题",
    content: "初始内容",
    clock,
  });
  assert(r.ok);
  if (!r.ok) return;
  const before = r.value.updatedAt;
  // 等 5ms 让 updatedAt 有差异
  await new Promise((res) => setTimeout(res, 5));
  const upd = r.value.update(
    { title: "新标题", content: "新内容", payloadJson: '{"a":1}' },
    clock,
  );
  assert(upd.ok);
  assertEquals(r.value.title, "新标题");
  assertEquals(r.value.content, "新内容");
  assertEquals(r.value.payloadJson, '{"a":1}');
  assert(r.value.updatedAt.getTime() > before.getTime());
});

Deno.test("BusinessModuleItem.adopt / unadopt — 切换 status", () => {
  const clock = new SystemClock();
  const r = BusinessModuleItem.create({
    projectId: newProjectId(),
    kind: "activity",
    title: "推进",
    clock,
  });
  assert(r.ok);
  if (!r.ok) return;
  const a = r.value.adopt(clock);
  assert(a.ok);
  assertEquals(r.value.status, "adopted");
  const u = r.value.unadopt(clock);
  assert(u.ok);
  assertEquals(r.value.status, "unadopted");
});

Deno.test("AdoptionStatus — participates() 排除 unadopted", () => {
  const a = AdoptionStatus.create("pending");
  const b = AdoptionStatus.create("adopted");
  const c = AdoptionStatus.create("unadopted");
  assert(a.ok && b.ok && c.ok);
  if (!a.ok || !b.ok || !c.ok) return;
  assert(a.value.participates());
  assert(b.value.participates());
  assertFalse(c.value.participates());
  assert(b.value.isAdopted());
  assertFalse(a.value.isAdopted());
});

Deno.test("BusinessModuleItem.rehydrate — 接受已存快照并保留状态", () => {
  const pid = newProjectId();
  const r = BusinessModuleItem.create({
    projectId: pid,
    kind: "use_case",
    title: "用例 A",
    status: "adopted",
    content: "用例 A 的详细描述",
    clock: new SystemClock(),
  });
  assert(r.ok);
  if (!r.ok) return;
  const snap = r.value.snapshot();
  const rehydrated = BusinessModuleItem.rehydrate(snap);
  assertEquals(rehydrated.title, "用例 A");
  assertEquals(rehydrated.status, "adopted");
  assertEquals(rehydrated.content, "用例 A 的详细描述");
  assertEquals(rehydrated.kind, "use_case");
});
