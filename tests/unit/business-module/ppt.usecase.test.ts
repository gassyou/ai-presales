/**
 * PptUseCase 单元测试（阶段 7.4c）
 *
 * 覆盖：list / create / update / delete / reorder / exportMarkdown
 * 流式 generatePages：另在集成测试中验证（mock client）
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqlitePptPagesRepository } from "@backend/persistence/sqlite/sqlite-ppt-pages.repository.ts";
import { PptUseCase } from "@backend/application/business-module/ppt.usecase.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
}

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

async function setup(): Promise<{ pid: ProjectId; uc: PptUseCase; clock: FixedClock }> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "ppt-uc", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error();
  const repo = new SqlitePptPagesRepository(db);
  return { pid: r.value.id, uc: new PptUseCase(repo, makeLogger(), clock), clock };
}

// ---------- CRUD ----------

Deno.test("PptUseCase — create + list 完整闭环", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.create(pid, { title: "封面", prompt: "..." });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  assertEquals(r1.value.title, "封面");
  assertEquals(r1.value.ordinal, 0);
  assertEquals(r1.value.prompt, "...");

  const list = await uc.list(pid);
  assertEquals(list.length, 1);
  assertEquals(list[0]?.title, "封面");
});

Deno.test("PptUseCase — 空 title 拒绝", async () => {
  const { pid, uc } = await setup();
  const r = await uc.create(pid, { title: "  " });
  assert(!r.ok);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("PptUseCase — update 部分 patch", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.create(pid, { title: "A", prompt: "old" });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  const u = await uc.update(r1.value.id, { title: "B", prompt: "new" });
  assert(u.ok);
  if (!u.ok) throw new Error();
  assertEquals(u.value.title, "B");
  assertEquals(u.value.prompt, "new");
});

Deno.test("PptUseCase — update 不存在的 id → NOT_FOUND", async () => {
  const { uc } = await setup();
  const r = await uc.update("nope", { title: "x" });
  assert(!r.ok);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "NOT_FOUND");
});

Deno.test("PptUseCase — update 空 title → INVALID_INPUT", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.create(pid, { title: "A" });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  const u = await uc.update(r1.value.id, { title: "   " });
  assert(!u.ok);
  if (u.ok) throw new Error();
  assertEquals(u.error.code, "INVALID_INPUT");
});

Deno.test("PptUseCase — delete 移除列表", async () => {
  const { pid, uc } = await setup();
  const r1 = await uc.create(pid, { title: "A" });
  assert(r1.ok);
  if (!r1.ok) throw new Error();
  await uc.create(pid, { title: "B" });
  const d = await uc.delete(r1.value.id);
  assert(d.ok);
  const list = await uc.list(pid);
  assertEquals(list.length, 1);
  assertEquals(list[0]?.title, "B");
});

// ---------- Reorder ----------

Deno.test("PptUseCase — reorder 按 ids 重排 ordinal", async () => {
  const { pid, uc } = await setup();
  const a = await uc.create(pid, { title: "A" });
  const b = await uc.create(pid, { title: "B" });
  const c = await uc.create(pid, { title: "C" });
  assert(a.ok && b.ok && c.ok);
  if (!a.ok || !b.ok || !c.ok) throw new Error();
  // 把顺序倒过来：C, A, B
  const r = await uc.reorder(pid, [c.value.id, a.value.id, b.value.id]);
  assert(r.ok);
  if (!r.ok) throw new Error();
  const list = await uc.list(pid);
  assertEquals(list.map((p) => p.title), ["C", "A", "B"]);
  assertEquals(list[0]?.ordinal, 0);
  assertEquals(list[1]?.ordinal, 1);
  assertEquals(list[2]?.ordinal, 2);
});

Deno.test("PptUseCase — reorder 含外部 id → INVALID_INPUT", async () => {
  const { pid, uc } = await setup();
  const a = await uc.create(pid, { title: "A" });
  assert(a.ok);
  if (!a.ok) throw new Error();
  const r = await uc.reorder(pid, [a.value.id, "ghost"]);
  assert(!r.ok);
  if (r.ok) throw new Error();
  assertEquals(r.error.code, "INVALID_INPUT");
});

// ---------- Export ----------

Deno.test("PptUseCase — exportMarkdown 按 ordinal 输出", async () => {
  const { pid, uc } = await setup();
  await uc.create(pid, { title: "封面", prompt: "intro" });
  await uc.create(pid, { title: "痛点", prompt: "pain 1\npain 2" });
  await uc.create(pid, { title: "总结", prompt: "end" });
  const r = await uc.exportMarkdown(pid);
  assert(r.ok);
  if (!r.ok) throw new Error();
  const md = r.value.markdown;
  assert(md.startsWith("# 提案 PPT 设计"));
  assert(md.includes("## 1. 封面"));
  assert(md.includes("## 2. 痛点"));
  assert(md.includes("## 3. 总结"));
  assert(md.includes("pain 1\npain 2"));
});

Deno.test("PptUseCase — exportMarkdown 空项目 → 仅标题", async () => {
  const { pid, uc } = await setup();
  const r = await uc.exportMarkdown(pid);
  assert(r.ok);
  if (!r.ok) throw new Error();
  assertEquals(r.value.markdown, "# 提案 PPT 设计\n");
});

Deno.test("PptUseCase — 空项目 list → []", async () => {
  const { pid, uc } = await setup();
  const list = await uc.list(pid);
  assertEquals(list, []);
});