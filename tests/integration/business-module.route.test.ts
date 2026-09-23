/**
 * /api/projects/:id/modules/:kind/items + /api/modules/items/:id 路由集成测试
 *
 * 阶段 7.0。覆盖：
 *   - 列表（空 / 非空 / status 过滤）
 *   - 新建 + 默认 status（markdown=adopted / 结构化=pending）
 *   - 单条 GET / PATCH / DELETE
 *   - adopt / unadopt action
 *   - 未知 kind → 400
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import {
  handleBusinessModule,
  type BusinessModuleRouteDeps,
} from "@backend/presentation/routes/business-module.route.ts";
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

async function setup(db: Database): Promise<{ pid: ProjectId; deps: BusinessModuleRouteDeps }> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "bm-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  return {
    pid: r.value.id,
    deps: { logger: makeLogger(), service: bmSvc },
  };
}

Deno.test("GET list — 空项目返回空数组", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const req = new Request(`http://x/api/projects/${pid}/modules/activity/items`, { method: "GET" });
  const res = await handleBusinessModule(req, deps, `/api/projects/${pid}/modules/activity/items`);
  assertEquals(res.status, 200);
  const body = await res.json() as { items: unknown[]; kind: string };
  assertEquals(body.items.length, 0);
  assertEquals(body.kind, "activity");
});

Deno.test("POST — markdown_* 默认 adopted", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/markdown_proposal/items`;
  const req = new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "方案草稿", content: "# 引言\n…" }),
  });
  const res = await handleBusinessModule(req, deps, path);
  assertEquals(res.status, 201);
  const body = await res.json() as { status: string; title: string };
  assertEquals(body.title, "方案草稿");
  assertEquals(body.status, "adopted");
});

Deno.test("POST — 结构化默认 pending", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/activity/items`;
  const req = new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "客户访谈" }),
  });
  const res = await handleBusinessModule(req, deps, path);
  assertEquals(res.status, 201);
  const body = await res.json() as { status: string };
  assertEquals(body.status, "pending");
});

Deno.test("PATCH — 更新 title/content/status", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/activity/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "客户访谈" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };

  const patchRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "客户访谈 v2", status: "adopted" }),
    }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  assertEquals(patchRes.status, 200);
  const patched = await patchRes.json() as { title: string; status: string };
  assertEquals(patched.title, "客户访谈 v2");
  assertEquals(patched.status, "adopted");
});

Deno.test("POST adopt / unadopt", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/activity/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const adoptRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/adopt`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/adopt`,
  );
  assertEquals(adoptRes.status, 200);
  const adopted = await adoptRes.json() as { status: string };
  assertEquals(adopted.status, "adopted");

  const unadoptRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/unadopt`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/unadopt`,
  );
  const unadopted = await unadoptRes.json() as { status: string };
  assertEquals(unadopted.status, "unadopted");
});

Deno.test("DELETE — 删除后 GET → 404", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/activity/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "X" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const delRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, { method: "DELETE" }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  assertEquals(delRes.status, 204);
  const getRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, { method: "GET" }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  assertEquals(getRes.status, 404);
});

Deno.test("POST — 未知 kind → 400", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/bogus/items`;
  const req = new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "X" }),
  });
  const res = await handleBusinessModule(req, deps, path);
  assertEquals(res.status, 400);
});

Deno.test("GET list — status=adopted 过滤", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/markdown_proposal/items`;
  // 两条 markdown_* 都默认 adopted
  for (const title of ["v1", "v2"]) {
    await handleBusinessModule(
      new Request(`http://x${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content: "..." }),
      }),
      deps,
      path,
    );
  }
  // 把 v2 改为 unadopted
  const listAll = await handleBusinessModule(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  const allBody = await listAll.json() as { items: { id: string; title: string }[] };
  const v2 = allBody.items.find((i) => i.title === "v2");
  assert(v2, "v2 should exist");
  await handleBusinessModule(
    new Request(`http://x/api/modules/items/${v2!.id}/unadopt`, { method: "POST" }),
    deps,
    `/api/modules/items/${v2!.id}/unadopt`,
  );

  const list = await handleBusinessModule(
    new Request(`http://x${path}?status=adopted`, { method: "GET" }),
    deps,
    path,  // path 不带 query；handler 从 url.searchParams 取 status
  );
  const body = await list.json() as { items: { title: string }[] };
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0].title, "v1");
});

// ---------- 阶段 7.4d：自定义页面（kind=custom） ----------

Deno.test("custom — POST 创建 + GET 列表含 2 条", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/custom/items`;
  for (const title of ["会议纪要", "客户清单"]) {
    const r = await handleBusinessModule(
      new Request(`http://x${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content: "" }),
      }),
      deps,
      path,
    );
    assertEquals(r.status, 201);
    const body = await r.json() as { status: string; kind: string };
    // 自定义页面不是 markdown → 默认 pending
    assertEquals(body.status, "pending");
    assertEquals(body.kind, "custom");
  }
  const list = await handleBusinessModule(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  const body = await list.json() as { items: { title: string }[] };
  assertEquals(body.items.length, 2);
});

Deno.test("custom — PATCH 改 title 持久化", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/custom/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "原标题" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const patchRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "新标题 v2" }),
    }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  assertEquals(patchRes.status, 200);
  const patched = await patchRes.json() as { title: string };
  assertEquals(patched.title, "新标题 v2");
});

Deno.test("custom — DELETE 后 GET → 404", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/custom/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "要删的" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const del = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, { method: "DELETE" }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  assertEquals(del.status, 204);
  const getRes = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}`, { method: "GET" }),
    deps,
    `/api/modules/items/${c.id}`,
  );
  assertEquals(getRes.status, 404);
});

Deno.test("custom — 项目内同标题允许重复", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/custom/items`;
  // 同名 "草稿" 两次创建（v1/v2 不重命名场景）
  for (let i = 0; i < 2; i++) {
    const r = await handleBusinessModule(
      new Request(`http://x${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "草稿" }),
      }),
      deps,
      path,
    );
    assertEquals(r.status, 201);
  }
  const list = await handleBusinessModule(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  const body = await list.json() as { items: unknown[] };
  assertEquals(body.items.length, 2);
});

Deno.test("custom — POST generate → content 含占位 stamp", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/custom/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "AI 测试" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const gen = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/generate`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/generate`,
  );
  assertEquals(gen.status, 200);
  const body = await gen.json() as { content: string; title: string };
  assert(body.content.startsWith(`# AI 测试`), "应包含 H1 标题");
  assert(body.content.includes("生成时间："), "应包含时间戳");
  // 阶段 7.5（H5）：未注入 invokeSubAgent → 走模板占位路径（fallback 已不带「占位逻辑」字样）
});

Deno.test("custom — POST generate 对 kind=activity 拒绝 → 400", async () => {
  const db = newDb();
  await db.ready();
  const { pid, deps } = await setup(db);
  const path = `/api/projects/${pid}/modules/activity/items`;
  const created = await handleBusinessModule(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "推进计划" }),
    }),
    deps,
    path,
  );
  const c = await created.json() as { id: string };
  const gen = await handleBusinessModule(
    new Request(`http://x/api/modules/items/${c.id}/generate`, { method: "POST" }),
    deps,
    `/api/modules/items/${c.id}/generate`,
  );
  assertEquals(gen.status, 400);
  const body = await gen.json() as { code: string };
  assertEquals(body.code, "INVALID_INPUT");
});

Deno.test("custom — POST generate 不存在的 id → 404", async () => {
  const db = newDb();
  await db.ready();
  const { deps } = await setup(db);
  const gen = await handleBusinessModule(
    new Request("http://x/api/modules/items/nonexistent-id/generate", { method: "POST" }),
    deps,
    "/api/modules/items/nonexistent-id/generate",
  );
  assertEquals(gen.status, 404);
});
