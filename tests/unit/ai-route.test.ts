/**
 * /api/ai/chat 路由集成测试 —— 用 FakeTransport 替换 SdkTransport
 *
 * 不打真网络；验证：
 *   - 请求 body 校验
 *   - profile 解析 + 缺 key
 *   - 调通到 LLM 后的 happy path
 *   - LLM 错误（401/429/500）映射到 ErrorEnvelope
 */

import { assert, assertEquals } from "@std/assert";
import { handleAiChat } from "@backend/presentation/routes/ai.route.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import { AnthropicClient } from "@backend/ai/client/anthropic.client.ts";
import { OpenAIClient } from "@backend/ai/client/openai.client.ts";
import { FakeTransport } from "../integration/fixtures/fake-transport.ts";

function makeLogger(): Logger {
  const sink = (_line: string) => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    warn: sink,
    error: sink,
    info: sink,
  };
}

function makeConfig(): AppConfig {
  return {
    app: { name: "test", version: "0", dataDir: "/tmp" },
    server: { host: "127.0.0.1", port: 8000 },
    defaultProfile: "fast",
    profiles: {
      fast: { provider: "anthropic", model: "claude-haiku-4-5", temperature: 0.2, maxTokens: 4096 },
      local: { provider: "openai", model: "gpt-4o-mini", temperature: 0.3, maxTokens: 2048 },
    },
    knowledge: {
      ragTopK: 5,
      ragMinScore: 0.5,
      embeddingProvider: "openai",
      embeddingModel: "x",
      embeddingDim: 1536,
      chunkMaxTokens: 500,
      chunkOverlapTokens: 50,
      softFallbackOnVecMissing: true,
    },
    security: { toolRequireApproval: [], allowedPaths: [] },
    output: { defaultOutputDir: "/tmp" },
    logging: { level: "info", maxSizeMb: 1, maxBackups: 1 },
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://x/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("ai chat —— happy path (anthropic)", async () => {
  const t = new FakeTransport();
  t.reply("https://api.anthropic.com/v1/messages", 200, {
    id: "m1", model: "claude-haiku-4-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "你好！" }],
    usage: { input_tokens: 5, output_tokens: 5 },
  });
  const client: ILLMClient = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChat(makeRequest({ profile: "fast", messages: [{ role: "user", content: "hi" }] }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { content: Array<{ type: string; text?: string }>; stopReason: string };
  assertEquals(body.stopReason, "end_turn");
  assertEquals(body.content[0].text, "你好！");
});

Deno.test("ai chat —— happy path (openai)", async () => {
  const t = new FakeTransport();
  t.reply("https://api.openai.com/v1/chat/completions", 200, {
    id: "x", model: "gpt-4o-mini",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi back" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const client: ILLMClient = new OpenAIClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChat(makeRequest({ profile: "local", messages: [{ role: "user", content: "hi" }] }), deps);
  assertEquals(res.status, 200);
});

Deno.test("ai chat —— 未知 profile → 400 VALIDATION_FAILED", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("no"); } };
  const res = await handleAiChat(makeRequest({ profile: "nope", messages: [{ role: "user", content: "x" }] }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { code: string };
  assertEquals(body.code, "VALIDATION_FAILED");
});

Deno.test("ai chat —— 缺 messages → 400", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("no"); } };
  const res = await handleAiChat(makeRequest({ profile: "fast" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("ai chat —— resolver 抛错 → 400", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("api key missing"); } };
  const res = await handleAiChat(makeRequest({ profile: "fast", messages: [{ role: "user", content: "x" }] }), deps);
  assertEquals(res.status, 400);
});

Deno.test("ai chat —— 上游 401 → 401 LLM_AUTH_FAILED", async () => {
  const t = new FakeTransport();
  t.reply("https://api.anthropic.com/v1/messages", 401, { message: "bad key" });
  const client = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChat(makeRequest({ profile: "fast", messages: [{ role: "user", content: "x" }] }), deps);
  assertEquals(res.status, 401);
  const body = await res.json() as { code: string };
  assertEquals(body.code, "LLM_AUTH_FAILED");
});

Deno.test("ai chat —— 上游 429 → 429 LLM_RATE_LIMIT", async () => {
  const t = new FakeTransport();
  t.reply("https://api.anthropic.com/v1/messages", 429, { message: "slow down" });
  const client = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChat(makeRequest({ profile: "fast", messages: [{ role: "user", content: "x" }] }), deps);
  assertEquals(res.status, 429);
});

Deno.test("ai chat —— GET 方法 → 405", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("no"); } };
  const res = await handleAiChat(new Request("http://x/api/ai/chat", { method: "GET" }), deps);
  assertEquals(res.status, 405);
});

Deno.test("ai chat —— 无效 JSON body → 400", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("no"); } };
  const req = new Request("http://x/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json{",
  });
  const res = await handleAiChat(req, deps);
  assertEquals(res.status, 400);
});

void assert;