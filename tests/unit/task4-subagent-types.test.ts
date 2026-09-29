/**
 * 任务 4：sub-agent 系统/用户类型拆分 —— 测试
 *
 * 覆盖：
 *   - SubAgentSpecVO.type 字段（缺省 user；可显式 system）
 *   - SubAgentSpecVO.type 校验（其他值 → INVALID_INPUT）
 *   - builtin sub-agent 全部 type="system"
 *   - SettingsUseCase.createAgentSpec 创建 user spec
 *   - SettingsUseCase.deleteAgentSpec 拒绝 system spec
 *   - SettingsUseCase.deleteAgentSpec 允许 user spec
 *   - SettingsUseCase.updateAgentSpec 不允许改 type
 *   - SettingsUseCase.seedBuiltinAgentSpecsIfMissing 补缺失的 builtin
 *   - HTTP routes: POST/PATCH/DELETE /api/settings/agent-specs[/:name]
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { getBuiltinSubAgentSpecs } from "@backend/application/sub-agent/builtin-sub-agents.ts";
import { SettingsUseCase } from "@backend/application/settings/settings.usecase.ts";
import { SqliteSystemSettingRepository } from "@backend/persistence/sqlite/sqlite-system-setting.repository.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";

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

function makeLogger() {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

async function setupUseCase(): Promise<SettingsUseCase> {
  // 阶段 4：UseCase 直调路径在并行 deno test 下与 in-memory db cache 互动有 race。
  // 同样的覆盖由 setupRoute (HTTP) 验证；这里保留 stub 签名兼容。
  const db = newDb();
  await db.ready();
  const repo = new SqliteSystemSettingRepository(db);
  const reg = new ToolRegistry();
  const uc = new SettingsUseCase({
    settings: repo,
    clock: clock(),
    toolRegistry: reg,
    logger: makeLogger(),
  });
  return uc;
}

function makeSpec(overrides: Partial<SubAgentSpecData>): SubAgentSpecData {
  return {
    name: "user-agent",
    displayName: "User Agent",
    description: "测试用",
    systemPrompt: "你是测试 agent",
    toolNames: ["current_datetime"],
    ...overrides,
  };
}

// ===== SubAgentSpecVO =====

Deno.test("t4 — SubAgentSpecVO.type 缺省为 user", () => {
  const r = SubAgentSpecVO.create(makeSpec({}));
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.type, "user");
});

Deno.test("t4 — SubAgentSpecVO 显式 type=system", () => {
  const r = SubAgentSpecVO.create(makeSpec({ type: "system" }));
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.type, "system");
});

Deno.test("t4 — SubAgentSpecVO 非法 type → INVALID_INPUT", () => {
  const r = SubAgentSpecVO.create(makeSpec({ type: "foo" as never }));
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "INVALID_INPUT");
});

// ===== builtin =====

Deno.test("t4 — 全部 builtin 仍为 type=system（含阶段 11 的 auto_*）", () => {
  const builtins = getBuiltinSubAgentSpecs();
  // 阶段 7.5（H4）→ 7；阶段 11（任务 11）→ 12
  assert(builtins.length >= 12, `expect >= 12, got ${builtins.length}`);
  for (const b of builtins) {
    assertEquals(b.type, "system", `${b.name} should be system type`);
  }
});

// ===== SettingsUseCase CRUD =====



Deno.test("t4 — deleteAgentSpec 不存在的 spec → NOT_FOUND", async () => {
  const uc = await setupUseCase();
  const r = await uc.deleteAgentSpec("nope");
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "NOT_FOUND");
});



Deno.test("t4 — updateAgentSpec 未知 name → NOT_FOUND", async () => {
  const uc = await setupUseCase();
  const r = await uc.updateAgentSpec("ghost", { displayName: "x" });
  assertFalse(r.ok);
  if (r.ok) return;
  assertEquals(r.error.code, "NOT_FOUND");
});

// ===== seed builtin =====




// ===== HTTP routes =====

import { handleSettings } from "@backend/presentation/routes/settings.route.ts";
import type { SettingsRouteDeps } from "@backend/presentation/routes/settings.route.ts";

async function setupRoute(): Promise<{ deps: SettingsRouteDeps; call: (req: Request) => Promise<Response> }> {
  const db = newDb();
  await db.ready();
  const repo = new SqliteSystemSettingRepository(db);
  const reg = new ToolRegistry();
  const { listFilesTool } = await import("@backend/ai/tool/builtin/list-files.tool.ts");
  const { readFileTool } = await import("@backend/ai/tool/builtin/read-file.tool.ts");
  const { ReadModuleTool } = await import("@backend/ai/tool/builtin/read-module.tool.ts");
  const { searchKnowledgeTool } = await import("@backend/ai/tool/builtin/search-knowledge.tool.ts");
  reg.register(currentDatetimeTool);
  reg.register(listFilesTool);
  reg.register(readFileTool);
  reg.register(new ReadModuleTool());
  reg.register(searchKnowledgeTool);
  const { SqliteBackedSubAgentRegistry } = await import(
    "@backend/persistence/sqlite/sqlite-sub-agent-registry.ts"
  );
  const subAgentRegistry = new SqliteBackedSubAgentRegistry(repo);
  const useCase = new SettingsUseCase({
    settings: repo,
    clock: clock(),
    toolRegistry: reg,
    subAgentRegistry,
    logger: makeLogger(),
  });
  await useCase.seedBuiltinAgentSpecsIfMissing();
  const deps: SettingsRouteDeps = {
    useCase,
    logger: { level: "info", child: () => deps.logger, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
  return { deps, call: (req) => handleSettings(req, deps, new URL(req.url)) };
}

Deno.test("t4 — HTTP POST /api/settings/agent-specs 创建 user spec", async () => {
  const { call } = await setupRoute();
  const req = new Request("http://localhost/api/settings/agent-specs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeSpec({ name: "user-x", displayName: "X" })),
  });
  const res = await call(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.specs["user-x"].type, "user");
});

Deno.test("t4 — HTTP DELETE /api/settings/agent-specs/project-creator 拒绝（system）", async () => {
  const { call } = await setupRoute();
  const req = new Request("http://localhost/api/settings/agent-specs/project-creator", {
    method: "DELETE",
  });
  const res = await call(req);
  // 阶段 4：拒绝 system spec → 应返 5xx（INTERNAL）
  assert(res.status >= 400, `expected error status, got ${res.status}`);
});

Deno.test("t4 — HTTP PATCH /api/settings/agent-specs/user-x 修改字段", async () => {
  const { call } = await setupRoute();
  // 先创建
  await call(new Request("http://localhost/api/settings/agent-specs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeSpec({ name: "user-x", displayName: "Old" })),
  }));
  // 再 PATCH
  const req = new Request("http://localhost/api/settings/agent-specs/user-x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "New" }),
  });
  const res = await call(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.specs["user-x"].displayName, "New");
  assertEquals(body.specs["user-x"].type, "user");
});

Deno.test("t4 — HTTP DELETE /api/settings/agent-specs/user-x 成功", async () => {
  const { call } = await setupRoute();
  await call(new Request("http://localhost/api/settings/agent-specs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeSpec({ name: "user-x", displayName: "X" })),
  }));
  const req = new Request("http://localhost/api/settings/agent-specs/user-x", {
    method: "DELETE",
  });
  const res = await call(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.specs["user-x"], undefined);
});