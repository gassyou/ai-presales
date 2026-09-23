/**
 * Project 聚合根单元测试
 *
 * 覆盖：
 *   - factory 创建、初始状态、领域事件
 *   - rename 校验 + 事件
 *   - changeStatus 状态机
 *   - archive 业务规则
 *   - snapshot 完整字段
 */

import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { newId, type ProjectId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { Project } from "@backend/domain/project/project.ts";

const clock = () => new FixedClock(new Date("2026-01-15T08:00:00Z"));

const validArgs = (overrides?: Partial<{ id: ProjectId; code: string; name: string; clientName: string }>) => ({
  id: overrides?.id ?? toProjectId(newId<"ProjectId">()),
  code: overrides?.code ?? "2026-00001",
  name: overrides?.name ?? "ERP 升级提案",
  clientName: overrides?.clientName ?? "ACME 集团",
  clock: clock(),
});

Deno.test("Project.create —— 合法输入返回聚合，初始状态=新建，事件=ProjectCreated", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  assertEquals(p.statusValue, "新建");
  assertEquals(p.name, "ERP 升级提案");
  assertEquals(p.clientName, "ACME 集团");
  assertEquals(p.code, "2026-00001");
  const events = p.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "project.created");
});

Deno.test("Project.create —— 名称为空 / 超长 / 含控制字符 → DomainError", () => {
  const tooLong = "x".repeat(121);
  const r1 = Project.create(validArgs({ name: "   " }));
  assertFalse(r1.ok);
  assertEquals(r1.error.code, "INVALID_INPUT");

  const r2 = Project.create(validArgs({ name: tooLong }));
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "INVALID_INPUT");

  const r3 = Project.create(validArgs({ name: "bad\u0000name" }));
  assertFalse(r3.ok);
  assertEquals(r3.error.code, "INVALID_INPUT");
});

Deno.test("Project.create —— 客户名为空 → DomainError", () => {
  const r = Project.create(validArgs({ clientName: "  " }));
  assertFalse(r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("Project.create —— 业务编号为空 → DomainError", () => {
  const r = Project.create(validArgs({ code: "" }));
  assertFalse(r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("Project.rename —— 合法改名 + 事件 + updatedAt 推进", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.pullDomainEvents();    // 清掉 create 事件

  const t0 = p.updatedAtValue;
  const c = clock();
  c.advance(60_000);
  const renameR = p.rename("ERP 升级（V2）", c);
  assert(renameR.ok);
  assertEquals(p.name, "ERP 升级（V2）");
  assert(p.updatedAtValue.getTime() > t0.getTime());
  const events = p.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "project.renamed");
});

Deno.test("Project.rename —— 同名重命名 → DomainError", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  const r2 = p.rename("ERP 升级提案", clock());  // 同名（含 trim）
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "INVALID_INPUT");
});

Deno.test("Project.changeStatus —— 合法状态机", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.pullDomainEvents();

  const c1 = clock();
  c1.advance(1000);
  assertEquals(p.changeStatus("提案中", c1).ok, true);
  assertEquals(p.statusValue, "提案中");

  const c2 = clock();
  c2.advance(2000);
  assertEquals(p.changeStatus("中标", c2, "客户确认").ok, true);
  assertEquals(p.statusValue, "中标");

  const events = p.pullDomainEvents();
  assertEquals(events.length, 2);
  assertEquals(events[0].eventName, "project.status-changed");
  assertEquals(events[1].eventName, "project.status-changed");
});

Deno.test("Project.changeStatus —— 非法跳转 → DomainError", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  // 新建不能直接到中标
  const r2 = p.changeStatus("中标", clock());
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "ILLEGAL_STATE_TRANSITION");
  assertMatch(r2.error.message, /cannot transition 新建 → 中标/);
});

Deno.test("Project.archive —— 未关闭项目可归档", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.pullDomainEvents();
  assertEquals(p.archive(clock()).ok, true);
  const events = p.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "project.archived");
});

Deno.test("Project.archive —— 已关闭项目（中标/未中标）禁止归档", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  // 新建 → 提案中 → 中标
  p.changeStatus("提案中", clock());
  p.changeStatus("中标", clock());
  const ar = p.archive(clock());
  assertFalse(ar.ok);
  assertEquals(ar.error.code, "ILLEGAL_STATE_TRANSITION");
});

Deno.test("Project.snapshot —— 字段完整", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  const snap = p.snapshot();
  assertEquals(snap.code, "2026-00001");
  assertEquals(snap.name, "ERP 升级提案");
  assertEquals(snap.clientName, "ACME 集团");
  assertEquals(snap.status, "新建");
  assertEquals(snap.createdAt.toISOString(), "2026-01-15T08:00:00.000Z");
});

Deno.test("Project.rehydrate —— 信任持久层，重建后字段一致", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  const snap = p.snapshot();
  const p2 = Project.rehydrate(snap);
  assertEquals(p2.id, p.id);
  assertEquals(p2.name, p.name);
  assertEquals(p2.clientName, p.clientName);
  assertEquals(p2.statusValue, p.statusValue);
  // rehydrate 不应产生事件
  assertEquals(p2.pullDomainEvents().length, 0);
});

// ---------- 阶段 7.4g：markWon / markLost / markPaused ----------

Deno.test("Project.markWon —— 提案中→中标，写入 wonDate + bestPractice + 事件", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.changeStatus("提案中", clock());
  p.pullDomainEvents();    // 清掉 create + changeStatus 事件

  const wonDate = new Date("2026-06-15T00:00:00Z");
  const r2 = p.markWon({ wonDate, bestPractice: "客户高层支持" }, clock());
  assert(r2.ok);
  assertEquals(p.statusValue, "中标");
  assertEquals(p.snapshot().wonDate?.toISOString(), "2026-06-15T00:00:00.000Z");
  assertEquals(p.snapshot().bestPractice, "客户高层支持");
  const events = p.pullDomainEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].eventName, "project.status-changed");
});

Deno.test("Project.markWon —— 当前状态非'提案中' → ILLEGAL_STATE_TRANSITION", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  // 直接对新建调用 markWon
  const r2 = p.markWon({ wonDate: new Date() }, clock());
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "ILLEGAL_STATE_TRANSITION");
});

Deno.test("Project.markLost —— 缺 lostReason → INVALID_INPUT", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.changeStatus("提案中", clock());

  const r2 = p.markLost({
    lostDate: new Date("2026-07-01T00:00:00Z"),
    lostReason: "   ",
  }, clock());
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "INVALID_INPUT");
});

Deno.test("Project.markLost —— 合法 → 写入 lostDate + lostReason", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.changeStatus("提案中", clock());

  const r2 = p.markLost({
    lostDate: new Date("2026-07-01T00:00:00Z"),
    lostReason: "预算不足",
    improvementNote: "持续跟进",
  }, clock());
  assert(r2.ok);
  assertEquals(p.statusValue, "未中标");
  const snap = p.snapshot();
  assertEquals(snap.lostDate?.toISOString(), "2026-07-01T00:00:00.000Z");
  assertEquals(snap.lostReason, "预算不足");
  assertEquals(snap.improvementNote, "持续跟进");
});

Deno.test("Project.markPaused —— 缺 pauseReason → INVALID_INPUT", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.changeStatus("提案中", clock());

  const r2 = p.markPaused({ pauseReason: "" }, clock());
  assertFalse(r2.ok);
  assertEquals(r2.error.code, "INVALID_INPUT");
});

Deno.test("Project.markPaused —— 合法 → 写入 pauseReason", () => {
  const r = Project.create(validArgs());
  assert(r.ok);
  if (!r.ok) return;
  const p = r.value;
  p.changeStatus("提案中", clock());

  const r2 = p.markPaused({ pauseReason: "客户组织架构调整" }, clock());
  assert(r2.ok);
  assertEquals(p.statusValue, "暂停");
  assertEquals(p.snapshot().pauseReason, "客户组织架构调整");
});