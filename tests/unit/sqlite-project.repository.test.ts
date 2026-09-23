/**
 * SqliteProjectRepository 单元测试
 *
 * 用 in-memory SQLite —— 无扩展加载、无文件 IO。
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";

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

Deno.test("repo.save + findById —— round-trip", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-02-01T00:00:00Z"));
  const svc = new ProjectService({ repo, clock });

  const r = await svc.createProject({ name: "ERP", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.code, "2026-00001");

  const got = await repo.findById(r.value.id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.name, "ERP");
  assertEquals(got.value.code, "2026-00001");
  assertEquals(got.value.clientName, "ACME");
  assertEquals(got.value.statusValue, "新建");
});

Deno.test("repo —— nextProjectCode 自增且按年分桶", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);

  assertEquals(await repo.nextProjectCode(2026), "2026-00001");
  assertEquals(await repo.nextProjectCode(2026), "2026-00002");
  assertEquals(await repo.nextProjectCode(2027), "2027-00001");
  assertEquals(await repo.nextProjectCode(2026), "2026-00003");
});

Deno.test("repo.list —— 分页 + 过滤 + 排序", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-02-01T00:00:00Z"));
  const svc = new ProjectService({ repo, clock });

  await svc.createProject({ name: "ERP", clientName: "ACME" });
  await svc.createProject({ name: "MES", clientName: "ACME" });
  await svc.createProject({ name: "WMS", clientName: "BETA" });

  const all = await repo.list({ limit: 10, offset: 0 });
  assertEquals(all.total, 3);
  assertEquals(all.items.length, 3);

  const onlyAcme = await repo.list({ search: "ACME", limit: 10, offset: 0 });
  assertEquals(onlyAcme.total, 2);

  const limit1 = await repo.list({ limit: 1, offset: 0 });
  assertEquals(limit1.items.length, 1);
  assertEquals(limit1.total, 3);

  const page2 = await repo.list({ limit: 1, offset: 1 });
  assertEquals(page2.items.length, 1);
  assert(page2.items[0].id !== limit1.items[0].id, "page2 should be a different project");
});

Deno.test("repo —— rename via service 持久化，updatedAt 推进", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-02-01T00:00:00Z"));
  const svc = new ProjectService({ repo, clock });

  const r = await svc.createProject({ name: "ERP", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) return;
  const id = r.value.id;

  clock.advance(60_000);
  const rename = await svc.renameProject(id, "ERP V2");
  assert(rename.ok);
  if (!rename.ok) return;
  assertEquals(rename.value.name, "ERP V2");
  assert(rename.value.updatedAt.getTime() > rename.value.createdAt.getTime());

  const fresh = await repo.findSnapshotById(id);
  assertEquals(fresh?.name, "ERP V2");
});

Deno.test("repo —— 状态机非法跳转返回 ILLEGAL_STATE_TRANSITION", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-02-01T00:00:00Z"));
  const svc = new ProjectService({ repo, clock });

  const r = await svc.createProject({ name: "ERP", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) return;
  const id = r.value.id;

  const bad = await svc.changeProjectStatus(id, "中标");
  assertEquals(bad.ok, false);
  if (bad.ok) return;
  assertEquals(bad.error.code, "ILLEGAL_STATE_TRANSITION");
});

Deno.test("repo —— delete 后 findById 返回 NOT_FOUND", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-02-01T00:00:00Z"));
  const svc = new ProjectService({ repo, clock });

  const r = await svc.createProject({ name: "ERP", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) return;
  const id = r.value.id;

  const del = await svc.deleteProject(id);
  assert(del.ok);

  const got = await repo.findById(id);
  assertEquals(got.ok, false);
  if (got.ok) return;
  assertEquals(got.error.code, "NOT_FOUND");
});