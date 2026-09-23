/**
 * /api/ai/chat/stream 路由集成测试
 *
 * 不打真网络；用 FakeTransport.stream() 喂一段 chunk 序列，
 * 验证 SSE 帧格式 + done 后收尾。
 */

import { assert, assertEquals } from "@std/assert";
import { handleAiChatStream } from "@backend/presentation/routes/ai.route.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import { AnthropicClient } from "@backend/ai/client/anthropic.client.ts";
import { OpenAIClient } from "@backend/ai/client/openai.client.ts";
import { FakeTransport } from "./fixtures/fake-transport.ts";

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
  return new Request("http://x/api/ai/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
}

async function readSseEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    const dataLines = trimmed.split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice("data:".length).trim());
    if (dataLines.length === 0) continue;
    for (const d of dataLines) events.push(JSON.parse(d));
  }
  return events;
}

Deno.test("ai stream —— anthropic chunks → SSE 帧序列", async () => {
  const t = new FakeTransport();
  t.streamResponse("https://api.anthropic.com/v1/messages", [
    { type: "message_start", message: { id: "m1", model: "claude-haiku-4-5", usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，世界" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ]);
  const client: ILLMClient = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChatStream(makeRequest({ profile: "fast", messages: [{ role: "user", content: "hi" }] }), deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const events = await readSseEvents(res);
  const chunks = events.filter((e) => e.type === "chunk");
  assertEquals(chunks.length, 2);
  assertEquals((chunks[0] as { delta: string }).delta, "你好");
  assertEquals((chunks[1] as { delta: string }).delta, "，世界");
  const done = events.find((e) => e.type === "done");
  assert(done);
  const usage = (done as { usage: { inputTokens: number; outputTokens: number } }).usage;
  assertEquals(usage.inputTokens, 3);
});

Deno.test("ai stream —— openai chunks → SSE 帧序列", async () => {
  const t = new FakeTransport();
  t.streamResponse("https://api.openai.com/v1/chat/completions", [
    { id: "cmpl-1", model: "gpt-4o-mini", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" } }] },
    { id: "cmpl-1", model: "gpt-4o-mini", choices: [{ index: 0, delta: { content: " world" } }] },
    { id: "cmpl-1", model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
  ]);
  const client: ILLMClient = new OpenAIClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChatStream(makeRequest({ profile: "local", messages: [{ role: "user", content: "hi" }] }), deps);
  assertEquals(res.status, 200);
  const events = await readSseEvents(res);
  const chunks = events.filter((e) => e.type === "chunk");
  assertEquals(chunks.length, 2);
  assertEquals((chunks[0] as { delta: string }).delta, "Hello");
  assertEquals((chunks[1] as { delta: string }).delta, " world");
  const done = events.find((e) => e.type === "done");
  assert(done);
});

Deno.test("ai stream —— 缺 profile → 400 ErrorEnvelope (非 SSE)", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("no"); } };
  const res = await handleAiChatStream(makeRequest({ profile: "nope", messages: [{ role: "user", content: "x" }] }), deps);
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("content-type"), "application/json; charset=utf-8");
});

Deno.test("ai stream —— GET 方法 → 405", async () => {
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => { throw new Error("no"); } };
  const res = await handleAiChatStream(new Request("http://x/api/ai/chat/stream", { method: "GET" }), deps);
  assertEquals(res.status, 405);
});

Deno.test("ai stream —— tool_call 事件转发", async () => {
  const t = new FakeTransport();
  t.streamResponse("https://api.anthropic.com/v1/messages", [
    { type: "message_start", message: { id: "m1", model: "claude-haiku-4-5", usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "get_weather" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"city\":" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"SF\"}" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
    { type: "message_stop" },
  ]);
  const client: ILLMClient = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  const deps = { logger: makeLogger(), config: makeConfig(), clientResolver: () => client };
  const res = await handleAiChatStream(makeRequest({ profile: "fast", messages: [{ role: "user", content: "weather?" }] }), deps);
  const events = await readSseEvents(res);
  const toolCall = events.find((e) => e.type === "tool_call");
  assert(toolCall);
  const tc = toolCall as { toolCallId: string; name: string; args: { city: string } };
  assertEquals(tc.name, "get_weather");
  assertEquals(tc.args.city, "SF");
});

void assert;