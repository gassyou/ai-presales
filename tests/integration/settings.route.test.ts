/**
 * /api/settings/* 集成测试 —— 阶段 7.4h
 *
 * 覆盖：
 *   - GET snapshot 4 类齐全
 *   - GET 单独 4 个 endpoint
 *   - PUT 写盘 + 返回 updatedAt
 *   - 乐观并发 CONFLICT
 *   - 校验失败 → 400 INVALID_INPUT
 *   - PUT 后 GET 看到新值
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
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import {
  handleSettings,
  type SettingsRouteDeps,
} from "@backend/presentation/routes/settings.route.ts";

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

async function setupDeps(): Promise<{ deps: SettingsRouteDeps; tmpRoot: string }> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-settings-rt-" });
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
  const resolver = new LLMClientResolver(async () => {
    throw new Error("not used");
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
    deps: { logger: makeLogger(), useCase },
    tmpRoot,
  };
}

function req(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://x${path}`, init);
}

async function call(deps: SettingsRouteDeps, method: string, path: string, body?: unknown): Promise<Response> {
  return await handleSettings(req(method, path, body), deps, new URL(`http://x${path}`));
}

// ---------- snapshot ----------

Deno.test("settings.route — GET /api/settings 返回 4 类空快照", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "GET", "/api/settings");
    assertEquals(res.status, 200);
    const body = await res.json() as {
      llmProfiles: unknown;
      mailAccounts: unknown;
      toolConfigs: unknown;
      agentSpecs: unknown;
    };
    // 全 null（首次启动，未 seed）
    assertEquals(body.llmProfiles, null);
    assertEquals(body.mailAccounts, null);
    assertEquals(body.toolConfigs, null);
    assertEquals(body.agentSpecs, null);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- LLM profiles 端到端 ----------

Deno.test("settings.route — PUT/GET llm-profiles 闭环", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const putRes = await call(deps, "PUT", "/api/settings/llm-profiles", {
      defaultProfile: "fast",
      profiles: [{
        name: "fast",
        provider: "anthropic",
        apiKey: "k",
        model: "claude-sonnet-4.5",
        temperature: 0.5,
        maxTokens: 4096,
      }],
    });
    assertEquals(putRes.status, 200);
    const putBody = await putRes.json() as { defaultProfile: string; updatedAt: string };
    assertEquals(putBody.defaultProfile, "fast");
    assert(putBody.updatedAt);

    const getRes = await call(deps, "GET", "/api/settings/llm-profiles");
    const getBody = await getRes.json() as { defaultProfile: string; profiles: Array<{ name: string }> };
    assertEquals(getBody.defaultProfile, "fast");
    assertEquals(getBody.profiles[0].name, "fast");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- 乐观并发 ----------

Deno.test("settings.route — PUT with stale expectedUpdatedAt → 409 CONFLICT", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    // 第一次 PUT
    await call(deps, "PUT", "/api/settings/llm-profiles", {
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
    // 用过期时间戳 PUT
    const res = await call(deps, "PUT", "/api/settings/llm-profiles", {
      defaultProfile: "p1",
      profiles: [{
        name: "p1",
        provider: "anthropic",
        apiKey: "k",
        model: "m2",
        temperature: 0.5,
        maxTokens: 1024,
      }],
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    });
    assertEquals(res.status, 409);
    const body = await res.json() as { code: string };
    assertEquals(body.code, "CONFLICT");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- 校验失败 ----------

Deno.test("settings.route — PUT 校验失败 → 400 INVALID_INPUT", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "PUT", "/api/settings/llm-profiles", {
      defaultProfile: "ghost",
      profiles: [{
        name: "p1",
        provider: "anthropic",
        apiKey: "k",
        model: "m",
        temperature: 0.5,
        maxTokens: 1024,
      }],
    });
    assertEquals(res.status, 400);
    const body = await res.json() as { code: string };
    assertEquals(body.code, "INVALID_INPUT");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("settings.route — PUT mail-accounts 多账号无 default → 400", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "PUT", "/api/settings/mail-accounts", {
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
    assertEquals(res.status, 400);
    const body = await res.json() as { code: string };
    assertEquals(body.code, "INVALID_INPUT");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("settings.route — PUT mail-accounts port=0 → 400", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "PUT", "/api/settings/mail-accounts", {
      accounts: [{
        id: "a1",
        displayName: "A",
        host: "smtp.example.com",
        port: 0,
        username: "u",
        password: "p",
        fromAddress: "u@example.com",
        ssl: "tls",
        isDefault: true,
      }],
    });
    assertEquals(res.status, 400);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// 阶段 7.7：apiKey="" 不再被 settings 拒绝（启动期 seed 用空占位）
// 运行时 createLlmClient 会抛清晰错误：'LLM profile "p1" has no API key configured.'
Deno.test("settings.route — PUT llm-profiles apiKey=\"\" → 200（允许，启动期 seed 用）", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "PUT", "/api/settings/llm-profiles", {
      defaultProfile: "p1",
      profiles: [{
        name: "p1",
        provider: "anthropic",
        apiKey: "",
        model: "m",
        temperature: 0.5,
        maxTokens: 1024,
      }],
    });
    assertEquals(res.status, 200);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- Tool configs 默认值 ----------

Deno.test("settings.route — GET tool-configs 空表 → 返回默认 config（每个已知工具为空对象）", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "GET", "/api/settings/tool-configs");
    assertEquals(res.status, 200);
    const body = await res.json() as { configs: Record<string, unknown>; updatedAt: string | null };
    assertEquals(body.configs, {});
    assertEquals(body.updatedAt, null);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- Agent specs 端到端 ----------

Deno.test("settings.route — PUT agent-specs 成功 + GET 看到新 spec", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "PUT", "/api/settings/agent-specs", {
      specs: {
        "test-agent": {
          name: "test-agent",
          displayName: "Test",
          description: "test desc",
          systemPrompt: "you are a test",
          toolNames: ["fake_a"],
        },
      },
    });
    assertEquals(res.status, 200);
    const body = await res.json() as { specs: Record<string, { displayName: string }>; updatedAt: string };
    assertEquals(body.specs["test-agent"].displayName, "Test");
    assert(body.updatedAt);

    // GET 验证
    const getRes = await call(deps, "GET", "/api/settings/agent-specs");
    const getBody = await getRes.json() as { specs: Record<string, { displayName: string }> };
    assertEquals(getBody.specs["test-agent"].displayName, "Test");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("settings.route — PUT agent-specs 引用已删除工具 → 400", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "PUT", "/api/settings/agent-specs", {
      specs: {
        "test-agent": {
          name: "test-agent",
          displayName: "Test",
          description: "d",
          systemPrompt: "p",
          toolNames: ["fake_a", "missing_tool"],
        },
      },
    });
    assertEquals(res.status, 400);
    const body = await res.json() as { code: string };
    assertEquals(body.code, "INVALID_INPUT");
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- 405/404 ----------

Deno.test("settings.route — 不支持的 method → 405", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "POST", "/api/settings/llm-profiles");
    assertEquals(res.status, 405);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

Deno.test("settings.route — 未知 path → 404", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    const res = await call(deps, "GET", "/api/settings/unknown-thing");
    assertEquals(res.status, 404);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});

// ---------- PUT without expectedUpdatedAt 走 last-write-wins ----------

Deno.test("settings.route — PUT without expectedUpdatedAt → last-write-wins 成功", async () => {
  const { deps, tmpRoot } = await setupDeps();
  try {
    await call(deps, "PUT", "/api/settings/llm-profiles", {
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
    const res = await call(deps, "PUT", "/api/settings/llm-profiles", {
      defaultProfile: "p1",
      profiles: [{
        name: "p1",
        provider: "anthropic",
        apiKey: "k",
        model: "m2",
        temperature: 0.5,
        maxTokens: 1024,
      }],
    });
    assertEquals(res.status, 200);
  } finally {
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(tmpRoot, { recursive: true });
  }
});