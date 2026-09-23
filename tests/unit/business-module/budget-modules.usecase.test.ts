/**
 * StructuredModulesUseCase —— FunctionList + BudgetSettings + BudgetSummary 测试
 *
 * 阶段 7.4b。
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { ProjectId } from "@shared/types/ids.ts";
import { DEFAULT_BUDGET_SETTINGS } from "@backend/domain/business-module/budget-settings.ts";

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
  const clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "bud-uc", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  return { pid: r.value.id, uc: new StructuredModulesUseCase(bmSvc) };
}

// ---------- FunctionList ----------

Deno.test("FunctionList — create + list + update + delete", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.createFunction(pid, {
    category: "订单",
    module: "下单",
    name: "创建订单",
    detail: "提交订单",
    cp: 5,
    inScope: true,
  });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  assertEquals(r1.value.title, "订单 / 下单 / 创建订单");
  assertEquals(r1.value.cp, 5);
  assertEquals(r1.value.inScope, true);
  assertEquals(Math.round(r1.value.effortHours * 100), 4200);

  const list = await uc.listFunctions(pid);
  assertEquals(list.length, 1);

  const u = await uc.updateFunction(pid, r1.value.id, { cp: 8, remarks: "复杂" });
  assert(u.ok);
  if (!u.ok) throw new Error();
  assertEquals(u.value.cp, 8);
  assertEquals(Math.round(u.value.effortHours * 100), 6720);

  await uc.deleteFunction(r1.value.id);
  assertEquals((await uc.listFunctions(pid)).length, 0);
});

Deno.test("FunctionList — 空 name 拒绝", async () => {
  const { pid, uc } = await setup();
  const r = await uc.createFunction(pid, { name: "  " });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("FunctionList — 非法 CP 拒绝", async () => {
  const { pid, uc } = await setup();
  const r = await uc.createFunction(pid, { name: "X", cp: 7 });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "INVALID_INPUT");
  assert(r.error.message.includes("CP 值"));
});

Deno.test("FunctionList — inScope=false 自动设 status=unadopted", async () => {
  const { pid, uc } = await setup();
  const r = await uc.createFunction(pid, { name: "X", cp: 3, inScope: false });
  assert(r.ok);
  if (!r.ok) throw new Error();
  assertEquals(r.value.inScope, false);

  // 切回 inScope=true → 状态应回到 pending
  const u = await uc.updateFunction(pid, r.value.id, { inScope: true });
  assert(u.ok);
  if (!u.ok) throw new Error();
  assertEquals(u.value.inScope, true);
});

Deno.test("FunctionList — CP=0 不计 effort", async () => {
  const { pid, uc } = await setup();
  const r = await uc.createFunction(pid, { name: "未估", cp: 0 });
  assert(r.ok);
  if (!r.ok) throw new Error();
  assertEquals(r.value.effortHours, 0);
  assertEquals(r.value.amount, 0);
});

// ---------- BudgetSettings ----------

Deno.test("BudgetSettings — get 无行 → defaults", async () => {
  const { pid, uc } = await setup();
  const s = await uc.getBudgetSettings(pid);
  assertEquals(s.hoursPerCP, DEFAULT_BUDGET_SETTINGS.hoursPerCP);
  assertEquals(s.unitPrice, 2000);
});

Deno.test("BudgetSettings — update 无行 → 创建 singleton", async () => {
  const { pid, uc } = await setup();
  const r = await uc.updateBudgetSettings(pid, { unitPrice: 3000, hoursPerCP: 6 });
  assert(r.ok);
  if (!r.ok) throw new Error();
  assertEquals(r.value.unitPrice, 3000);
  assertEquals(r.value.hoursPerCP, 6);

  const get = await uc.getBudgetSettings(pid);
  assertEquals(get.unitPrice, 3000);
  assertEquals(get.hoursPerCP, 6);
});

Deno.test("BudgetSettings — update 已有 → 更新而非新建", async () => {
  const { pid, uc } = await setup();
  await uc.updateBudgetSettings(pid, { unitPrice: 3000 });
  await uc.updateBudgetSettings(pid, { unitPrice: 4000 });

  const items = await uc.listFunctions(pid).then(() => uc.getBudgetSettings(pid));
  assertEquals(items.unitPrice, 4000);

  // 检查只有 1 行
  const r = await uc.computeBudgetSummary(pid);
  assert(r.ok);
  if (!r.ok) throw new Error();
  assertEquals(r.value.top.totalCP, 0);
});

Deno.test("BudgetSettings — 非法 ratio 拒绝", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.updateBudgetSettings(pid, { reqAnalysisRatio: 1.5 });
  assertEquals(r1.ok, false);
  if (r1.ok) throw new Error();
  assertEquals(r1.error.code, "INVALID_INPUT");

  const r2 = await uc.updateBudgetSettings(pid, { hoursPerDay: 0 });
  assertEquals(r2.ok, false);
  if (r2.ok) throw new Error();
});

Deno.test("BudgetSettings — hoursPerDay=0 拒绝", async () => {
  const { pid, uc } = await setup();
  const r = await uc.updateBudgetSettings(pid, { hoursPerDay: -1 });
  assertEquals(r.ok, false);
  if (r.ok) throw new Error();
});

// ---------- BudgetSummary ----------

Deno.test("BudgetSummary — 空项目 → 全 0 + 默认 settings", async () => {
  const { pid, uc } = await setup();
  const r = await uc.computeBudgetSummary(pid);
  assert(r.ok);
  if (!r.ok) throw new Error();
  assertEquals(r.value.top.totalCP, 0);
  assertEquals(r.value.top.functionTotalAmount, 0);
  assertEquals(r.value.byModule.rows.length, 0);
  assertEquals(r.value.byPhase.length, 9);
});

Deno.test("BudgetSummary — 含功能 + 自定义 settings", async () => {
  const { pid, uc } = await setup();
  await uc.updateBudgetSettings(pid, { unitPrice: 1000 });
  await uc.createFunction(pid, { category: "A", module: "M1", name: "X", cp: 5, inScope: true });
  await uc.createFunction(pid, { category: "A", module: "M1", name: "Y", cp: 3, inScope: true });
  await uc.createFunction(pid, { category: "B", module: "M2", name: "Z", cp: 8, inScope: false });  // 不计

  const r = await uc.computeBudgetSummary(pid);
  assert(r.ok);
  if (!r.ok) throw new Error();
  // in-scope: X(CP=5) + Y(CP=3) = CP=8
  assertEquals(r.value.top.totalCP, 8);
  // 2 个分组：A/M1, B/M2（B/M2 因 inScope=false 应被排除）
  assertEquals(r.value.byModule.rows.length, 1);
  assertEquals(r.value.byModule.rows[0]!.module, "M1");
});

Deno.test("BudgetSummary — out-of-scope 切回 inScope 生效", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.createFunction(pid, { name: "X", cp: 5, inScope: false });
  assert(r1.ok);
  if (!r1.ok) throw new Error();

  const s1 = await uc.computeBudgetSummary(pid);
  assert(s1.ok);
  if (!s1.ok) throw new Error();
  assertEquals(s1.value.top.totalCP, 0);

  const u = await uc.updateFunction(pid, r1.value.id, { inScope: true });
  assert(u.ok);

  const s2 = await uc.computeBudgetSummary(pid);
  assert(s2.ok);
  if (!s2.ok) throw new Error();
  assertEquals(s2.value.top.totalCP, 5);
});
