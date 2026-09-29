/**
 * 任务 13（阶段 13 / PR #5）：Skill 系统 —— HTTP 路由 + slash dispatcher + builtin skills
 *
 * 覆盖：
 *   - GET /api/skills 返 { items: [{name, displayName, description, inputSchema}] }
 *   - POST /api/skills/:name/invoke 调 SkillRegistry.execute → {ok:true, output}
 *   - POST /api/skills/missing/invoke → 404
 *   - POST /api/skills/:name/invoke Skill.execute 抛错 → {ok:false, error}
 *   - slash dispatcher：/skill skill_echo <msg> → 短路 LLM，返 skill output
 *   - slash dispatcher：普通 user 文本 → 不拦截，走 LLM（client.chat 被调）
 *   - slash dispatcher：/skill unknown → 404
 *   - builtin skill_status_check：返 JSON {chatSessions, projects, generatedAt}
 *   - builtin skill_summarize_project：mock businessModuleService + llmClient → 返 LLM 输出
 *   - builtin skill_draft_email：同 summarize
 *   - makeBuiltinSkills 注册 3 个 skill
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { type Skill, SkillRegistry } from "@backend/ai/skill/skill.ts";
import type { ToolContext } from "@backend/ai/tool/tool.ts";
import { handleSkillRoute, type SkillRouteDeps } from "@backend/presentation/routes/skill.route.ts";
import {
  type AiChatRouteDeps,
  handleAiChat,
  handleAiChatStream,
} from "@backend/presentation/routes/ai.route.ts";
import { type BuiltinSkillsDeps, makeBuiltinSkills } from "@backend/ai/skill/builtin-skills.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type {
  ChatRequest,
  ChatResult,
  ILLMClient,
  ProviderCapabilities,
  StreamEvent,
} from "@backend/ai/client/llm-client.ts";
import type { ProjectService } from "@backend/application/project/project.service.ts";
import type { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import type { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import { SystemClock } from "@backend/domain/shared/clock.ts";

// ====== Fixtures ======

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  } as unknown as Logger;
}

function fakeCtx(): ToolContext {
  return {
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [],
    timeoutMs: 1000,
  };
}

function fakeProfile(): ProfileConfig {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.2,
    maxTokens: 2048,
  };
}

function fakeConfig(): AppConfig {
  return {
    app: { name: "test", version: "0", dataDir: "/tmp" },
    server: { host: "0", port: 0 },
    profiles: { fast: fakeProfile() },
    defaultProfile: "fast",
    knowledge: {
      ragTopK: 5,
      ragMinScore: 0.5,
      embeddingProvider: "mock",
      embeddingModel: "x",
      embeddingDim: 8,
      chunkMaxTokens: 800,
      chunkOverlapTokens: 100,
      softFallbackOnVecMissing: false,
    },
    security: { toolRequireApproval: [], allowedPaths: [] },
    output: {},
    autoMode: { defaultSubAgent: "default", maxAgents: 4 },
    llm: { profiles: [] },
  } as unknown as AppConfig;
}

/** 假 LLM client：chat 返固定文本（用来检测有没有被 dispatcher 拦截） */
function fakeLlmClient(answer: string): ILLMClient & { called: number } {
  const obj = {
    provider: "openai" as const,
    called: 0,
    async chat(_req: ChatRequest): Promise<ChatResult> {
      obj.called += 1;
      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: answer }],
          stopReason: "end_turn",
          model: "fake-model",
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
    async *stream(_req: ChatRequest): AsyncIterable<StreamEvent> {
      obj.called += 1;
      yield { type: "chunk", delta: answer };
      yield { type: "done" };
    },
    capabilities(): ProviderCapabilities {
      return { provider: "openai", supportsTools: false, supportsStreaming: true };
    },
  };
  return obj;
}

// ====== HTTP route tests ======

function newSkillRouteDeps(skills: Skill[] = []): SkillRouteDeps {
  const reg = new SkillRegistry();
  for (const s of skills) reg.register(s);
  return { registry: reg, logger: makeLogger() };
}

async function jsonReq(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Request> {
  const { method = "GET", body } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

Deno.test({
  name: "t13 — GET /api/skills 列出 skill（name + displayName + description + inputSchema）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const FAKE: Skill = {
      name: "skill_x",
      displayName: "X",
      description: "x desc",
      inputSchema: { type: "object", properties: { a: { type: "string" } } },
      execute: async () => "ok",
    };
    const deps = newSkillRouteDeps([FAKE]);
    const req = await jsonReq("/api/skills");
    const resp = await handleSkillRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.items.length, 1);
    assertEquals(body.items[0].name, "skill_x");
    assertEquals(body.items[0].displayName, "X");
    assertEquals(body.items[0].description, "x desc");
    assertEquals(body.items[0].inputSchema.type, "object");
  },
});

Deno.test({
  name: "t13 — POST /api/skills/:name/invoke 同步执行 skill → {ok:true, output}",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const FAKE: Skill = {
      name: "skill_x",
      displayName: "X",
      description: "x",
      inputSchema: { type: "object", properties: {} },
      execute: async (args) => `got ${JSON.stringify(args)}`,
    };
    const deps = newSkillRouteDeps([FAKE]);
    const req = await jsonReq("/api/skills/skill_x/invoke", {
      method: "POST",
      body: { args: { message: "hi" } },
    });
    const resp = await handleSkillRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.ok, true);
    assertStringIncludes(String(body.output), "hi");
  },
});

Deno.test({
  name: "t13 — POST /api/skills/missing/invoke → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const deps = newSkillRouteDeps();
    const req = await jsonReq("/api/skills/no-such/invoke", {
      method: "POST",
      body: { args: {} },
    });
    const resp = await handleSkillRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 404);
  },
});

Deno.test({
  name: "t13 — POST /api/skills/:name/invoke Skill.execute 抛错 → {ok:false, error}",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const BOOM: Skill = {
      name: "skill_boom",
      displayName: "Boom",
      description: "boom",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("kaboom");
      },
    };
    const deps = newSkillRouteDeps([BOOM]);
    const req = await jsonReq("/api/skills/skill_boom/invoke", {
      method: "POST",
      body: { args: {} },
    });
    const resp = await handleSkillRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.ok, false);
    assertStringIncludes(String(body.error), "kaboom");
  },
});

// ====== slash dispatcher (ai.route) tests ======

function newAiChatRouteDeps(
  client: ILLMClient,
  skillRegistry?: SkillRegistry,
): AiChatRouteDeps {
  return {
    logger: makeLogger(),
    config: fakeConfig(),
    clientResolver: async () => client,
    ...(skillRegistry ? { skillRegistry } : {}),
  };
}

Deno.test({
  name: 't13 — handleAiChat: /skill skill_echo {"message":"hi"} 走 dispatcher，不调 LLM',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = fakeLlmClient("LLM should not be called");
    const reg = new SkillRegistry();
    reg.register({
      name: "skill_echo",
      displayName: "Echo",
      description: "echo",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
      execute: async (args) => `echo: ${(args as { message: string }).message}`,
    });
    const deps = newAiChatRouteDeps(client, reg);
    const req = await jsonReq("/api/ai/chat", {
      method: "POST",
      body: {
        profile: "fast",
        messages: [{ role: "user", content: '/skill skill_echo {"message":"hi"}' }],
      },
    });
    const resp = await handleAiChat(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    // content 是数组；把 text 拼出来断言
    const text = (body.content as Array<{ type: string; text?: string }>)
      .map((p) => p.text ?? "")
      .join("");
    assertStringIncludes(text, "echo: hi");
    assertEquals(client.called, 0, "LLM 不应被调用");
  },
});

Deno.test({
  name: "t13 — handleAiChat: 普通 user 文本走 LLM，不被 dispatcher 拦截",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = fakeLlmClient("hi from llm");
    const reg = new SkillRegistry();
    reg.register({
      name: "skill_echo",
      displayName: "Echo",
      description: "x",
      inputSchema: { type: "object", properties: {} },
      execute: async () => "x",
    });
    const deps = newAiChatRouteDeps(client, reg);
    const req = await jsonReq("/api/ai/chat", {
      method: "POST",
      body: {
        profile: "fast",
        messages: [{ role: "user", content: "普通的 hello" }],
      },
    });
    const resp = await handleAiChat(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    const text = (body.content as Array<{ type: string; text?: string }>)
      .map((p) => p.text ?? "")
      .join("");
    assertStringIncludes(text, "hi from llm");
    assertEquals(client.called, 1);
  },
});

Deno.test({
  name: "t13 — handleAiChat: /skill unknown → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = fakeLlmClient("hi");
    const reg = new SkillRegistry();
    const deps = newAiChatRouteDeps(client, reg);
    const req = await jsonReq("/api/ai/chat", {
      method: "POST",
      body: {
        profile: "fast",
        messages: [{ role: "user", content: "/skill skill_does_not_exist" }],
      },
    });
    const resp = await handleAiChat(req, deps);
    assertEquals(resp.status, 404);
  },
});

Deno.test({
  name: "t13 — handleAiChatStream: /skill 也走 dispatcher（同步路径相同）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const client = fakeLlmClient("LLM");
    const reg = new SkillRegistry();
    reg.register({
      name: "skill_echo",
      displayName: "Echo",
      description: "x",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
      execute: async (args) => `echo: ${(args as { message: string }).message}`,
    });
    const deps = newAiChatRouteDeps(client, reg);
    const req = await jsonReq("/api/ai/chat/stream", {
      method: "POST",
      body: {
        profile: "fast",
        messages: [{ role: "user", content: '/skill skill_echo {"message":"stream-hi"}' }],
      },
    });
    const resp = await handleAiChatStream(req, deps);
    // dispatcher 返 200 + JSON（不走 SSE）
    assertEquals(resp.status, 200);
    const body = await resp.json();
    const text = (body.content as Array<{ type: string; text?: string }>)
      .map((p) => p.text ?? "")
      .join("");
    assertStringIncludes(text, "echo: stream-hi");
    assertEquals(client.called, 0);
  },
});

// ====== builtin skills ======

Deno.test({
  name: "t13 — makeBuiltinSkills 注册 3 个 builtin skill",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const skills = makeBuiltinSkills(fakeBuiltinDeps());
    const names = new Set(skills.map((s) => s.name));
    assert(names.has("skill_status_check"));
    assert(names.has("skill_summarize_project"));
    assert(names.has("skill_draft_email"));
    assertEquals(skills.length, 3);
  },
});

function fakeBuiltinDeps(overrides: Partial<BuiltinSkillsDeps> = {}): BuiltinSkillsDeps {
  const projectService = {
    getProject: async () => ({
      ok: true as const,
      value: {
        id: "p1" as never,
        code: "P-001",
        name: "测试项目",
        clientName: "客户 A",
        clientWebsite: "https://a.example",
      } as unknown as Awaited<ReturnType<ProjectService["getProject"]>>["value"],
    }),
    listProjects: async () => ({
      items: [],
      total: 0,
      limit: 1,
      offset: 0,
    }),
  } as unknown as ProjectService;
  const businessModuleService = {
    listItems: async () => [
      {
        id: "i1",
        projectId: "p1" as never,
        kind: "markdown_business_current" as const,
        title: "业务现状",
        content: "客户是制造业，年营收 50 亿。",
        status: "adopted" as const,
        payloadJson: "{}",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  } as unknown as BusinessModuleService;
  const chatSessionUseCase = {
    listAllSessions: () => [],
  } as unknown as ChatSessionUseCase;
  return {
    llmClient: fakeLlmClient("llm-summary-output"),
    defaultProfile: fakeProfile(),
    projectService,
    businessModuleService,
    chatSessionUseCase,
    logger: makeLogger(),
    ...overrides,
  };
}

Deno.test({
  name: "t13 — builtin skill_status_check 返 JSON {chatSessions, projects, generatedAt}",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const skills = makeBuiltinSkills(fakeBuiltinDeps());
    const sk = skills.find((s) => s.name === "skill_status_check");
    assertExists(sk);
    const out = await sk.execute({}, fakeCtx());
    assert(typeof out === "string");
    const parsed = JSON.parse(out);
    assertEquals(parsed.chatSessions, 0);
    assertEquals(parsed.projects, 0);
    assertExists(parsed.generatedAt);
  },
});

Deno.test({
  name: "t13 — builtin skill_summarize_project 读 markdown 模块 + 调 LLM",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const deps = fakeBuiltinDeps();
    const skills = makeBuiltinSkills(deps);
    const sk = skills.find((s) => s.name === "skill_summarize_project");
    assertExists(sk);
    const out = await sk.execute({ projectId: "p1" }, fakeCtx());
    assertEquals(out, "llm-summary-output");
  },
});

Deno.test({
  name: "t13 — builtin skill_draft_email 读 markdown_business_current + 调 LLM",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const deps = fakeBuiltinDeps();
    const skills = makeBuiltinSkills(deps);
    const sk = skills.find((s) => s.name === "skill_draft_email");
    assertExists(sk);
    const out = await sk.execute({ projectId: "p1" }, fakeCtx());
    assertEquals(out, "llm-summary-output");
  },
});

Deno.test({
  name: "t13 — builtin skill_summarize_project 项目不存在返错误文本",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const deps = fakeBuiltinDeps({
      projectService: {
        getProject: async () => ({
          ok: false as const,
          error: { code: "NOT_FOUND", message: "not found", meta: {} } as unknown as never,
        }),
        listProjects: async () => ({ items: [], total: 0, limit: 1, offset: 0 }),
      } as unknown as ProjectService,
    });
    const skills = makeBuiltinSkills(deps);
    const sk = skills.find((s) => s.name === "skill_summarize_project");
    assertExists(sk);
    const out = await sk.execute({ projectId: "missing" }, fakeCtx());
    assertStringIncludes(String(out), "项目不存在");
  },
});

// 用 SystemClock 让 unused import 不被 lint 抱怨
const _clock = new SystemClock();
void _clock;
