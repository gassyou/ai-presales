/**
 * SqliteBackedSubAgentRegistry 单元测试 —— 阶段 7.4h
 *
 * 覆盖：
 *   - seed 后 list 包含 5 个 builtin
 *   - update settings 后 get 拿到新 spec
 *   - 未知 name → undefined
 *   - register() 返回错误（只读）
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteSystemSettingRepository } from "@backend/persistence/sqlite/sqlite-system-setting.repository.ts";
import { SqliteBackedSubAgentRegistry } from "@backend/persistence/sqlite/sqlite-sub-agent-registry.ts";
import { getBuiltinSubAgentSpecs } from "@backend/application/sub-agent/builtin-sub-agents.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";

async function setup(): Promise<{ repo: SqliteSystemSettingRepository; registry: SqliteBackedSubAgentRegistry; clock: Clock; tmpRoot: string }> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-sa-registry-ut-" });
  const db = new Database({
    paths: {
      root: tmpRoot,
      data: tmpRoot,
      logs: tmpRoot,
      vendor: tmpRoot,
      output: tmpRoot,
    },
    inMemory: true,
    skipExtensions: true,
  });
  await db.ready();
  const clock = new FixedClock(new Date("2026-09-22T00:00:00Z"));
  const repo = new SqliteSystemSettingRepository(db);
  return {
    repo,
    registry: new SqliteBackedSubAgentRegistry(repo),
    clock,
    tmpRoot,
  };
}

async function seedBuiltins(repo: SqliteSystemSettingRepository, clock: Clock): Promise<void> {
  const specs = Object.fromEntries(
    getBuiltinSubAgentSpecs().map((s) => [s.name, s]),
  );
  await repo.seedIfEmpty("agents.specs" as Parameters<typeof repo.seedIfEmpty>[0], { specs }, clock);
}

Deno.test("SqliteBackedSubAgentRegistry — seed 后 list 包含 6 个 builtin", async () => {
  const { repo, registry, clock, tmpRoot } = await setup();
  try {
    await seedBuiltins(repo, clock);
    await registry.refreshSyncCacheAsync();
    const names = registry.names();
    // 阶段 7.5（H4）新增 markdown-author，故总数从 5 增至 6
    assertEquals(names.length, 6);
    assert(names.includes("project-creator"));
    assert(names.includes("survey-researcher"));
    assert(names.includes("proposal-drafter"));
    assert(names.includes("ppt-designer"));
    assert(names.includes("business-email-writer"));
    assert(names.includes("markdown-author"));
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("SqliteBackedSubAgentRegistry — update settings 后 get 拿到新 spec", async () => {
  const { repo, registry, clock, tmpRoot } = await setup();
  try {
    await seedBuiltins(repo, clock);
    await registry.refreshSyncCacheAsync();

    // 改 project-creator 的 displayName
    const cur = await repo.getAgentSpecs();
    assert(cur);
    const specs = cur.value.specs as unknown as Record<string, { displayName: string }>;
    specs["project-creator"].displayName = "改名后的项目创建";

    await repo.setAgentSpecs({ specs: specs as never }, clock, cur.updatedAt);
    await registry.refreshSyncCacheAsync();

    const got = registry.get("project-creator");
    assert(got);
    assertEquals(got.displayName, "改名后的项目创建");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("SqliteBackedSubAgentRegistry — 未知 name → undefined", async () => {
  const { repo, registry, clock, tmpRoot } = await setup();
  try {
    await seedBuiltins(repo, clock);
    await registry.refreshSyncCacheAsync();
    assertEquals(registry.get("does-not-exist"), undefined);
    assertEquals(registry.has("does-not-exist"), false);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("SqliteBackedSubAgentRegistry — register() 返回错误（只读）", async () => {
  const { registry, tmpRoot } = await setup();
  try {
    const fakeVO = {
      name: "x",
      displayName: "",
      description: "",
      systemPrompt: "",
      toolNames: [],
      profileHint: undefined,
    } as never;
    const r = registry.register(fakeVO);
    assert(!r.ok);
    assertEquals(r.error.code, "INTERNAL");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});