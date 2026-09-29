/**
 * 任务 2：项目工作区 —— 测试
 *
 * 覆盖：
 *   - Project entity：setWorkspace 校验 + 默认策略
 *   - ProjectService：setWorkspace / resolveWorkspacePath / ensureWorkspace
 *   - 仓储 migration 013：paused_date 列已加
 *   - 仓储 round-trip：保存后 rehydrate 保留 workspacePath
 *   - 工作区设置/创建后：snapshot.workspacePath 正确
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { Project } from "@backend/domain/project/project.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { Database } from "@backend/persistence/database/database.ts";
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

function clock(): FixedClock {
  return new FixedClock(new Date("2026-02-01T00:00:00Z"));
}

// ====== Project entity ======

Deno.test("t2 — Project.setWorkspace 接受绝对路径", () => {
  const r = Project.create({ code: "X", name: "X", clientName: "C", clock: clock() });
  assert(r.ok);
  if (!r.ok) return;
  const sR = r.value.setWorkspace("/Users/x/Desktop/X", clock());
  assert(sR.ok);
  if (!sR.ok) return;
  assertEquals(r.value.snapshot().workspacePath, "/Users/x/Desktop/X");
});

Deno.test("t2 — Project.setWorkspace 拒绝相对路径", () => {
  const r = Project.create({ code: "X", name: "X", clientName: "C", clock: clock() });
  assert(r.ok);
  if (!r.ok) return;
  const sR = r.value.setWorkspace("relative/path", clock());
  assertFalse(sR.ok);
  if (sR.ok) return;
  assertEquals(sR.error.code, "INVALID_INPUT");
  assertStringIncludes(sR.error.message, "absolute");
});

Deno.test("t2 — Project.setWorkspace 接受 null（清空）", () => {
  const r = Project.create({ code: "X", name: "X", clientName: "C", clock: clock() });
  assert(r.ok);
  if (!r.ok) return;
  r.value.setWorkspace("/Users/x/Desktop/X", clock());
  const sR = r.value.setWorkspace(null, clock());
  assert(sR.ok);
  if (!sR.ok) return;
  assertEquals(r.value.snapshot().workspacePath, null);
});

Deno.test("t2 — Project.resolveWorkspacePath 未设置时用默认 ~/Desktop/<code>", () => {
  const r = Project.create({ code: "2026-00099", name: "X", clientName: "C", clock: clock() });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(
    r.value.resolveWorkspacePath("/home/test"),
    "/home/test/Desktop/2026-00099",
  );
});

Deno.test("t2 — Project.resolveWorkspacePath 已设置时用用户值", () => {
  const r = Project.create({ code: "2026-00099", name: "X", clientName: "C", clock: clock() });
  assert(r.ok);
  if (!r.ok) return;
  r.value.setWorkspace("/custom/ws", clock());
  assertEquals(r.value.resolveWorkspacePath("/home/test"), "/custom/ws");
});

// ====== ProjectService ======

async function setupService(opts?: {
  fs?: {
    mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
    stat: (path: string) => Promise<{ isDirectory: boolean }>;
  };
}): Promise<{
  svc: ProjectService;
  repo: SqliteProjectRepository;
  id: import("@shared/types/ids.ts").ProjectId;
}> {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const svc = new ProjectService({
    repo,
    clock: clock(),
    ...(opts?.fs ? { workspaceFs: opts.fs } : {}),
  });
  const r = await svc.createProject({ name: "测试", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("unreachable");
  return { svc, repo, id: r.value.id };
}

Deno.test("t2 — ProjectService.setWorkspace 合法绝对路径写入 snapshot", async () => {
  const { svc, id } = await setupService();
  const r = await svc.setWorkspace(id, "/Users/x/Desktop/proj");
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.workspacePath, "/Users/x/Desktop/proj");
});

Deno.test("t2 — ProjectService.setWorkspace 拒绝非绝对路径", async () => {
  const { svc, id } = await setupService();
  const r = await svc.setWorkspace(id, "relative/path");
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("t2 — ProjectService.resolveWorkspacePath 未设置走默认", async () => {
  const { svc, id } = await setupService();
  const r = await svc.resolveWorkspacePath(id, "/home/test");
  assert(r.ok);
  if (!r.ok) return;
  // default ~/Desktop/<code>
  assertStringIncludes(r.value, "/Desktop/");
});

Deno.test("t2 — ProjectService.ensureWorkspace —— 路径不存在时 mkdir 并持久化", async () => {
  let mkdirCalled = false;
  const { svc, id } = await setupService({
    fs: {
      mkdir: async (path, opts) => {
        mkdirCalled = true;
        assertEquals(opts.recursive, true);
        assertStringIncludes(path, "/Desktop/");
      },
      stat: async () => ({ isDirectory: false }),
    },
  });
  const r = await svc.ensureWorkspace(id, { homeDir: "/home/test" });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(mkdirCalled, true, "mkdir 应被调用");
  assertEquals(r.value.created, true);
  assertEquals(r.value.existed, false);
  assertStringIncludes(r.value.path, "/Desktop/");
  // 持久化：re-fetch snapshot 应含 workspacePath
  const snap = await svc.getProject(id);
  assert(snap.ok);
  if (!snap.ok) return;
  assertEquals(snap.value.workspacePath, r.value.path);
});

Deno.test("t2 — ProjectService.ensureWorkspace —— 路径已存在则不创建", async () => {
  let mkdirCalled = false;
  const { svc, id } = await setupService({
    fs: {
      mkdir: async () => {
        mkdirCalled = true;
      },
      stat: async () => ({ isDirectory: true }),
    },
  });
  const r = await svc.ensureWorkspace(id, { homeDir: "/home/test" });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(mkdirCalled, false, "已存在不应 mkdir");
  assertEquals(r.value.existed, true);
  assertEquals(r.value.created, false);
});

Deno.test("t2 — ProjectService.ensureWorkspace —— mkdir 抛错 → WORKSPACE_CREATE_FAILED", async () => {
  const { svc, id } = await setupService({
    fs: {
      mkdir: async () => {
        throw new Error("permission denied");
      },
      stat: async () => ({ isDirectory: false }),
    },
  });
  const r = await svc.ensureWorkspace(id, { homeDir: "/home/test" });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "WORKSPACE_CREATE_FAILED");
});

// ====== 仓储 round-trip ======

Deno.test("t2 — SqliteProjectRepository save + rehydrate 保留 workspacePath", async () => {
  const { svc, id } = await setupService();
  const setR = await svc.setWorkspace(id, "/custom/ws/path");
  assert(setR.ok);
  // 重新 fetch（应走 repo.findSnapshotById）
  const got = await svc.getProject(id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.workspacePath, "/custom/ws/path");
});

Deno.test("t2 — SqliteProjectRepository 旧数据 workspacePath 为 null", async () => {
  const db = newDb();
  await db.ready();
  const repo = new SqliteProjectRepository(db);
  const svc = new ProjectService({ repo, clock: clock() });
  const cr = await svc.createProject({ name: "old", clientName: "C" });
  assert(cr.ok);
  if (!cr.ok) return;
  const got = await svc.getProject(cr.value.id);
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.workspacePath, null);
});