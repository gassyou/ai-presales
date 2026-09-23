/**
 * /api/projects/:id/hardware-items 集成测试
 *
 * 阶段 7.4f。
 *
 * 覆盖：
 *   - CRUD 闭环
 *   - 校验：qty<1 / unitPrice<0 → 400
 *   - 列表
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { HardwareItemsUseCase } from "@backend/application/business-module/hardware-items.usecase.ts";
import { handleHardwareItems } from "@backend/presentation/routes/hardware-items.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

interface Setup {
  pid: ProjectId;
  deps: { logger: Logger; useCase: HardwareItemsUseCase };
}

async function setup(): Promise<Setup> {
  const tmp = await Deno.makeTempDir({ prefix: "ai-hw-rt-" });
  const db = new Database({
    paths: { root: tmp, data: tmp, logs: tmp, vendor: tmp, output: tmp },
    inMemory: true,
    skipExtensions: true,
  });
  await db.ready();
  const clock = new FixedClock(new Date("2026-09-22T00:00:00Z"));
  const projRepo = new SqliteProjectRepository(db);
  const projSvc = new ProjectService({ repo: projRepo, clock });
  const r = await projSvc.createProject({ name: "hw-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmService = new BusinessModuleService({ repo: new SqliteBusinessModuleRepository(db), clock });
  const useCase = new HardwareItemsUseCase(bmService, clock);
  return {
    pid: r.value.id,
    deps: { logger: makeLogger(), useCase },
  };
}

Deno.test("hardware-items — CRUD 闭环", async () => {
  const { pid, deps } = await setup();
  const listPath = `/api/projects/${pid}/hardware-items`;
  const url = new URL(`http://x${listPath}`);

  // 初始空
  const emptyRes = await handleHardwareItems(
    new Request(`http://x${listPath}`, { method: "GET" }),
    deps, url,
  );
  assertEquals(emptyRes.status, 200);
  const emptyBody = await emptyRes.json() as { items: unknown[] };
  assertEquals(emptyBody.items.length, 0);

  // 创建
  const createRes = await handleHardwareItems(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "服务器", device: "S1", qty: 2, unitPrice: 1000 }),
    }),
    deps, url,
  );
  assertEquals(createRes.status, 201);
  const created = await createRes.json() as { id: string; item: { subtotal: number } };
  assertEquals(created.item.subtotal, 2000);

  // 列表
  const listRes = await handleHardwareItems(
    new Request(`http://x${listPath}`, { method: "GET" }),
    deps, url,
  );
  const list = await listRes.json() as { items: Array<{ id: string }> };
  assertEquals(list.items.length, 1);

  // 单条
  const oneRes = await handleHardwareItems(
    new Request(`http://x/api/modules/hardware-items/${created.id}`, { method: "GET" }),
    deps, new URL(`http://x/api/modules/hardware-items/${created.id}`),
  );
  assertEquals(oneRes.status, 200);

  // 更新
  const patchRes = await handleHardwareItems(
    new Request(`http://x/api/modules/hardware-items/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qty: 5 }),
    }),
    deps, new URL(`http://x/api/modules/hardware-items/${created.id}`),
  );
  assertEquals(patchRes.status, 200);
  const patched = await patchRes.json() as { item: { qty: number; subtotal: number } };
  assertEquals(patched.item.qty, 5);
  assertEquals(patched.item.subtotal, 5000);

  // 删除
  const delRes = await handleHardwareItems(
    new Request(`http://x/api/modules/hardware-items/${created.id}`, { method: "DELETE" }),
    deps, new URL(`http://x/api/modules/hardware-items/${created.id}`),
  );
  assertEquals(delRes.status, 204);
});

Deno.test("hardware-items — qty<1 → 400", async () => {
  const { pid, deps } = await setup();
  const listPath = `/api/projects/${pid}/hardware-items`;
  const url = new URL(`http://x${listPath}`);
  const res = await handleHardwareItems(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "服务器", device: "S1", qty: 0, unitPrice: 1000 }),
    }),
    deps, url,
  );
  assertEquals(res.status, 400);
});

Deno.test("hardware-items — unitPrice<0 → 400", async () => {
  const { pid, deps } = await setup();
  const listPath = `/api/projects/${pid}/hardware-items`;
  const url = new URL(`http://x${listPath}`);
  const res = await handleHardwareItems(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "服务器", device: "S1", qty: 1, unitPrice: -100 }),
    }),
    deps, url,
  );
  assertEquals(res.status, 400);
});

Deno.test("hardware-items — 不存在的 itemId → 404", async () => {
  const { deps } = await setup();
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const path = `/api/modules/hardware-items/${fakeId}`;
  const res = await handleHardwareItems(
    new Request(`http://x${path}`, { method: "GET" }),
    deps, new URL(`http://x${path}`),
  );
  assertEquals(res.status, 404);
});