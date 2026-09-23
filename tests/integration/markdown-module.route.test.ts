/**
 * markdown_* 模块路由集成测试
 *
 * 阶段 7.3。
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { MarkdownModuleService } from "@backend/application/business-module/markdown-module.service.ts";
import { handleMarkdownModule } from "@backend/presentation/routes/markdown-module.route.ts";
import type { MarkdownModuleRouteDeps } from "@backend/presentation/routes/markdown-module.route.ts";
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

async function setup(): Promise<{ pid: ProjectId; deps: MarkdownModuleRouteDeps }> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const ps = new ProjectService({ repo: projRepo, clock });
  const r = await ps.createProject({ name: "mm-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  return {
    pid: r.value.id,
    deps: {
      logger: makeLogger(),
      service: new MarkdownModuleService({ businessModuleService: bmSvc, clock }),
    },
  };
}

Deno.test("GET —— 无记录返回 item=null", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/markdown_business_current/markdown`;
  const res = await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { item: unknown };
  assertEquals(body.item, null);
});

Deno.test("POST —— getOrInit 用模板创建", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/markdown_pain_point/markdown`;
  const res = await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "POST" }),
    deps,
    path,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { content: string; status: string; title: string };
  assertEquals(body.title, "现状问题点 / 痛点");
  assertStringIncludes(body.content, "业务痛点");
  assertEquals(body.status, "adopted");
});

Deno.test("PUT —— 保存内容", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/markdown_roi/markdown`;
  // 先 getOrInit
  await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "POST" }),
    deps,
    path,
  );
  const putRes = await handleMarkdownModule(
    new Request(`http://x${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# 自定义 ROI\n…" }),
    }),
    deps,
    path,
  );
  assertEquals(putRes.status, 200);
  const updated = await putRes.json() as { content: string };
  assertEquals(updated.content, "# 自定义 ROI\n…");
});

Deno.test("POST generate —— AI 占位生成", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/markdown_roi/markdown/generate`;
  const res = await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "POST" }),
    deps,
    path,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { content: string };
  assertStringIncludes(body.content, "ROI 分析");
  assertStringIncludes(body.content, "生成时间");
});

Deno.test("POST adopt / unadopt —— 切换", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/markdown_to_be/markdown`;
  await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "POST" }),
    deps,
    path,
  );
  const adoptRes = await handleMarkdownModule(
    new Request(`http://x${path}/unadopt`, { method: "POST" }),
    deps,
    `${path}/unadopt`,
  );
  const a = await adoptRes.json() as { status: string };
  assertEquals(a.status, "unadopted");

  const reAdopt = await handleMarkdownModule(
    new Request(`http://x${path}/adopt`, { method: "POST" }),
    deps,
    `${path}/adopt`,
  );
  const b = await reAdopt.json() as { status: string };
  assertEquals(b.status, "adopted");
});

Deno.test("非 markdown kind 访问 markdown 端点 → 400", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/activity/markdown`;
  const res = await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  assertEquals(res.status, 400);
});

Deno.test("PUT body 缺 content → 400", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/modules/markdown_risk/markdown`;
  await handleMarkdownModule(
    new Request(`http://x${path}`, { method: "POST" }),
    deps,
    path,
  );
  const res = await handleMarkdownModule(
    new Request(`http://x${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    deps,
    path,
  );
  assertEquals(res.status, 400);
});
