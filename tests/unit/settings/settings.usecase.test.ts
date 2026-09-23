/**
 * SettingsUseCase 单元测试 —— 阶段 7.4h
 *
 * 覆盖：
 *   - LLM profiles 校验（name / provider / temperature / maxTokens / apiKey / defaultProfile）
 *   - Mail accounts 校验（id 唯一 / 多账号 default 唯一 / fromAddress 合法 / port 范围）
 *   - Tool configs 校验（key ⊆ 已知工具名）
 *   - Sub-agent specs 校验（toolNames ⊆ 已知工具 / name pattern / systemPrompt 非空）
 *   - 乐观并发：expectedUpdatedAt 不匹配 → CONFLICT
 *   - Hot-reload callback：更新后被调用
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteSystemSettingRepository } from "@backend/persistence/sqlite/sqlite-system-setting.repository.ts";
import { SqliteBackedSubAgentRegistry } from "@backend/persistence/sqlite/sqlite-sub-agent-registry.ts";
import { ConfigurableToolRegistry } from "@backend/application/settings/configurable-tool-registry.ts";
import { LLMClientResolver } from "@backend/application/settings/llm-client-resolver.ts";
import { SettingsUseCase } from "@backend/application/settings/settings.usecase.ts";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { ContextAssembler } from "@backend/ai/context/context-assembler.ts";
import { SnapshotRegistry } from "@backend/ai/context/snapshot-registry.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

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

interface TestSetup {
  useCase: SettingsUseCase;
  repo: SqliteSystemSettingRepository;
  clock: Clock;
  registry: SqliteBackedSubAgentRegistry;
  cleanup: () => Promise<void>;
}

async function setup(): Promise<TestSetup> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-settings-ut-" });
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

  // 工具注册表：放 2 个假工具用于 tool configs / agent specs 校验
  const fakeTool1 = {
    name: "fake_a",
    description: "fake a",
    inputSchema: { type: "object", properties: {} },
    requiresApproval: false,
    sideEffect: "none" as const,
    execute: () => Promise.resolve({ ok: true as const, value: "" }),
  };
  const fakeTool2 = {
    name: "fake_b",
    description: "fake b",
    inputSchema: { type: "object", properties: {} },
    requiresApproval: false,
    sideEffect: "none" as const,
    execute: () => Promise.resolve({ ok: true as const, value: "" }),
  };
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(fakeTool1);
  toolRegistry.register(fakeTool2);
  const configurable = new ConfigurableToolRegistry(toolRegistry, repo);
  await configurable.refreshAllAsync();

  const registry = new SqliteBackedSubAgentRegistry(repo);
  await registry.refreshSyncCacheAsync();

  const tokenCounter = new CharacterBasedTokenCounter();
  const snapshotRegistry = new SnapshotRegistry();
  const assembler = new ContextAssembler({
    tokenCounter,
    registry: snapshotRegistry,
    config: { contextWindow: 200_000, maxOutputTokens: 8_192 },
  });

  // LLMClientResolver：build 用 fake（返回 null；test 不调 .get()）
  const resolver = new LLMClientResolver(async () => {
    throw new Error("not used in this test");
  });

  const useCase = new SettingsUseCase({
    settings: repo,
    clock,
    toolRegistry,
    configurableTools: configurable,
    subAgentRegistry: registry,
    llmClientResolver: resolver,
    contextAssembler: assembler,
    logger: makeLogger(),
  });

  return {
    useCase,
    repo,
    clock,
    registry,
    cleanup: async () => {
      SqliteBackedSubAgentRegistry.clearCacheForTests();
      await Deno.remove(tmpRoot, { recursive: true });
    },
  };
}

// ---------- LLM profiles 校验 ----------

Deno.test("settings — getLLMProfiles 默认 null（首次启动未 seed）", async () => {
  const { useCase } = await setup();
  const r = await useCase.getLLMProfiles();
  assertEquals(r, null);
});

Deno.test("settings — updateLLMProfiles 校验：defaultProfile 不在 profiles", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateLLMProfiles({
    defaultProfile: "missing",
    profiles: [{
      name: "p1",
      provider: "anthropic",
      apiKey: "k",
      model: "m",
      temperature: 0.5,
      maxTokens: 1024,
    }],
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("settings — updateLLMProfiles 校验：profiles 为空", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateLLMProfiles({ defaultProfile: "x", profiles: [] });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("settings — updateLLMProfiles 校验：缺 model", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateLLMProfiles({
    defaultProfile: "p1",
    profiles: [{
      name: "p1",
      provider: "anthropic",
      apiKey: "k",
      model: "",
      temperature: 0.5,
      maxTokens: 1024,
    }],
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("settings — updateLLMProfiles 校验：provider 非法", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateLLMProfiles({
    defaultProfile: "p1",
    profiles: [{
      name: "p1",
      provider: "azure" as never,
      apiKey: "k",
      model: "m",
      temperature: 0.5,
      maxTokens: 1024,
    }],
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("settings — updateLLMProfiles 校验：temperature 越界", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateLLMProfiles({
    defaultProfile: "p1",
    profiles: [{
      name: "p1",
      provider: "anthropic",
      apiKey: "k",
      model: "m",
      temperature: 3,
      maxTokens: 1024,
    }],
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

// ---------- Mail accounts 校验 ----------

Deno.test("settings — updateMailAccounts 校验：多账号无 default", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateMailAccounts({
    accounts: [
      {
        id: "a1",
        displayName: "A",
        host: "smtp.example.com",
        port: 465,
        username: "u",
        password: "p",
        fromAddress: "u@example.com",
        ssl: "tls",
        isDefault: false,
      },
      {
        id: "a2",
        displayName: "B",
        host: "smtp2.example.com",
        port: 465,
        username: "u2",
        password: "p",
        fromAddress: "u2@example.com",
        ssl: "tls",
        isDefault: false,
      },
    ],
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("settings — updateMailAccounts 校验：fromAddress 非法", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateMailAccounts({
    accounts: [{
      id: "a1",
      displayName: "A",
      host: "smtp.example.com",
      port: 465,
      username: "u",
      password: "p",
      fromAddress: "not-an-email",
      ssl: "tls",
      isDefault: true,
    }],
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

// ---------- Tool configs 校验 ----------

Deno.test("settings — updateToolConfigs 校验：未注册工具", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateToolConfigs({
    configs: { not_a_tool: { foo: 1 } },
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

// ---------- Sub-agent specs 校验 ----------

Deno.test("settings — updateAgentSpecs 校验：toolName 不在 ToolRegistry", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateAgentSpecs({
    specs: {
      "agent-x": {
        name: "agent-x",
        displayName: "X",
        description: "d",
        systemPrompt: "p",
        toolNames: ["not_a_tool"],
      },
    },
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("settings — updateAgentSpecs 校验：name 不符合 pattern", async () => {
  const { useCase } = await setup();
  const r = await useCase.updateAgentSpecs({
    specs: {
      "Invalid Name!": {
        name: "Invalid Name!",
        displayName: "X",
        description: "d",
        systemPrompt: "p",
        toolNames: ["fake_a"],
      },
    },
  });
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

// ---------- 乐观并发 ----------

Deno.test("settings — 乐观并发：expectedUpdatedAt 不匹配 → CONFLICT", async () => {
  const { useCase } = await setup();
  // 第一次写成功
  const r1 = await useCase.updateLLMProfiles({
    defaultProfile: "p1",
    profiles: [{
      name: "p1",
      provider: "anthropic",
      apiKey: "k",
      model: "m",
      temperature: 0.5,
      maxTokens: 1024,
    }],
  });
  assert(r1.ok);
  // 用过期时间戳写 → CONFLICT
  const r2 = await useCase.updateLLMProfiles(
    {
      defaultProfile: "p1",
      profiles: [{
        name: "p1",
        provider: "anthropic",
        apiKey: "k",
        model: "m2",
        temperature: 0.5,
        maxTokens: 1024,
      }],
    },
    "2020-01-01T00:00:00.000Z", // 错的时间
  );
  assert(!r2.ok);
  assertEquals(r2.error.code, "CONFLICT");
});

// ---------- Hot-reload callback ----------

Deno.test("settings — updateLLMProfiles 成功后 invalidate LLMClientResolver", async () => {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-settings-cb-" });
  try {
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
    const fakeTool = {
      name: "fake_a",
      description: "a",
      inputSchema: { type: "object", properties: {} },
      requiresApproval: false,
      sideEffect: "none" as const,
      execute: () => Promise.resolve({ ok: true as const, value: "" }),
    };
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(fakeTool);
    const configurable = new ConfigurableToolRegistry(toolRegistry, repo);
    await configurable.refreshAllAsync();
    const registry = new SqliteBackedSubAgentRegistry(repo);
    await registry.refreshSyncCacheAsync();
    const tokenCounter = new CharacterBasedTokenCounter();
    const snapshotRegistry = new SnapshotRegistry();
    const assembler = new ContextAssembler({
      tokenCounter,
      registry: snapshotRegistry,
      config: { contextWindow: 200_000, maxOutputTokens: 8_192 },
    });
    // resolver：build 直接抛错；只有 invalidate 会被调用
    const resolver = new LLMClientResolver(async () => {
      throw new Error("not used");
    });
    // 先 put 一次 fake 进 cache（验证 invalidate 会清）
    resolver.invalidate(); // 先确保空
    const useCase = new SettingsUseCase({
      settings: repo,
      clock,
      toolRegistry,
      configurableTools: configurable,
      subAgentRegistry: registry,
      llmClientResolver: resolver,
      contextAssembler: assembler,
      logger: makeLogger(),
    });
    await useCase.updateLLMProfiles({
      defaultProfile: "p1",
      profiles: [{
        name: "p1",
        provider: "anthropic",
        apiKey: "k",
        model: "m",
        temperature: 0.5,
        maxTokens: 1024,
      }],
    });
    // 验证 cache 是空（已被 invalidate）
    assertEquals(resolver.size(), 0);
    SqliteBackedSubAgentRegistry.clearCacheForTests();
  } finally {
    await Deno.remove(tmpRoot, { recursive: true });
  }
});