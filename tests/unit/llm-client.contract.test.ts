/**
 * LLM 客户端契约测试 —— 所有 ILLMClient 实现必须通过
 *
 * 跑同一组请求 / 响应 fixture，对每个适配器执行同一断言：
 *   - 发送端拼出的 URL/headers/body 符合预期
 *   - 响应被映射到 canonical 时字段一致
 *   - 错误响应被翻译成 LlmError 且 code/retryable 正确
 */

import { assert, assertEquals } from "@std/assert";
import { AnthropicClient } from "@backend/ai/client/anthropic.client.ts";
import { OpenAIClient } from "@backend/ai/client/openai.client.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type {
  CanonicalMessage,
  ChatRequest,
} from "@backend/ai/message/canonical-message.ts";
import { LlmError } from "@backend/ai/transport.ts";
import { FakeTransport } from "../integration/fixtures/fake-transport.ts";
import { ToolCallId } from "@shared/types/ids.ts";

const sampleMessages: CanonicalMessage[] = [
  { role: "system", content: [{ type: "text", text: "你是助手" }] },
  { role: "user", content: [{ type: "text", text: "你好" }] },
];

const sampleRequest: ChatRequest = {
  systemPrompt: "你是助手",
  messages: sampleMessages,
  model: "claude-haiku-4-5",
  temperature: 0.5,
  maxOutputTokens: 256,
};

async function runAnthropicCase(): Promise<{
  url: string;
  authHeader: string | undefined;
  body: { model: string; system: string; messages: Array<{ role: string }> };
}> {
  const t = new FakeTransport();
  t.reply("https://api.anthropic.com/v1/messages", 200, {
    id: "msg_1",
    model: "claude-haiku-4-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "你好！" }],
    usage: { input_tokens: 11, output_tokens: 5 },
  });
  const c = new AnthropicClient({
    apiKey: "sk-ant-fake",
    model: "claude-haiku-4-5",
    transport: t,
  });
  const out = await c.chat(sampleRequest);
  assertEquals(out.message.role, "assistant");
  assertEquals(out.message.stopReason, "end_turn");
  assertEquals(out.message.usage.inputTokens, 11);
  assertEquals(out.message.usage.totalTokens, 16);
  const req0 = t.requests[0];
  return {
    url: req0.url,
    authHeader: req0.headers["x-api-key"],
    body: req0.body as { model: string; system: string; messages: Array<{ role: string }> },
  };
}

async function runOpenAICase(): Promise<{
  url: string;
  authHeader: string | undefined;
  body: { model: string; messages: Array<{ role: string }> };
}> {
  const t = new FakeTransport();
  t.reply("https://api.openai.com/v1/chat/completions", 200, {
    id: "x", model: "gpt-4o-mini",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "你好！" } }],
    usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
  });
  const c = new OpenAIClient({
    apiKey: "sk-openai-fake", model: "gpt-4o-mini", transport: t,
  });
  const out = await c.chat(sampleRequest);
  assertEquals(out.message.role, "assistant");
  assertEquals(out.message.stopReason, "end_turn");
  const req0 = t.requests[0];
  return {
    url: req0.url,
    authHeader: req0.headers["authorization"],
    body: req0.body as { model: string; messages: Array<{ role: string }> },
  };
}

Deno.test("contract: Anthropic —— 正确 URL + x-api-key + 顶层 system", async () => {
  const r = await runAnthropicCase();
  assertEquals(r.url, "https://api.anthropic.com/v1/messages");
  assertEquals(r.authHeader, "sk-ant-fake");
  assertEquals(r.body.system, "你是助手");
  assertEquals(r.body.model, "claude-haiku-4-5");
  // 顶层 system 已被 mapper 提取，messages 里没有 system role
  const roles = r.body.messages.map((m) => m.role);
  assert(!roles.includes("system"));
});

Deno.test("contract: OpenAI —— 正确 URL + Bearer + messages[0]=system", async () => {
  const r = await runOpenAICase();
  assertEquals(r.url, "https://api.openai.com/v1/chat/completions");
  assertEquals(r.authHeader, "Bearer sk-openai-fake");
  assertEquals(r.body.messages[0].role, "system");
});

Deno.test("contract: OpenAI chat —— request.model 不被 adapter 改写", async () => {
  const t = new FakeTransport();
  t.reply("https://api.openai.com/v1/chat/completions", 200, {
    id: "x", model: "gpt-4o-mini",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "x" } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
  const c = new OpenAIClient({ apiKey: "x", model: "gpt-4o-mini", transport: t });
  await c.chat({ ...sampleRequest, model: "gpt-4o" });   // 客户端应原样透传
  const body = t.requests[0].body as { model: string };
  assertEquals(body.model, "gpt-4o");
});

async function expectLlmError(
  run: () => Promise<unknown>,
  predicate: (e: LlmError) => boolean,
): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (e instanceof LlmError && predicate(e)) return;
    throw new Error(`expected LlmError matching predicate, got ${e instanceof Error ? e.constructor.name + ": " + e.message : String(e)}`);
  }
  throw new Error("expected promise to reject, but it resolved");
}

Deno.test("contract: 401 → LlmError LLM_AUTH_FAILED (Anthropic)", async () => {
  const t = new FakeTransport();
  t.reply("https://api.anthropic.com/v1/messages", 401, { message: "invalid api key" });
  const c = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  await expectLlmError(
    () => c.chat(sampleRequest),
    (e) => e.code === "LLM_AUTH_FAILED" && e.retryable === false,
  );
});

Deno.test("contract: 429 → LlmError LLM_RATE_LIMIT retryable=true", async () => {
  const t = new FakeTransport();
  t.reply("https://api.openai.com/v1/chat/completions", 429, { message: "rate limited" });
  const c = new OpenAIClient({ apiKey: "x", model: "x", transport: t });
  await expectLlmError(
    () => c.chat(sampleRequest),
    (e) => e.code === "LLM_RATE_LIMIT" && e.retryable === true,
  );
});

Deno.test("contract: 500 → LlmError LLM_UPSTREAM_ERROR retryable=true", async () => {
  const t = new FakeTransport();
  t.reply("https://api.openai.com/v1/chat/completions", 500, { message: "boom" });
  const c = new OpenAIClient({ apiKey: "x", model: "x", transport: t });
  await expectLlmError(
    () => c.chat(sampleRequest),
    (e) => e.code === "LLM_UPSTREAM_ERROR" && e.retryable === true,
  );
});

Deno.test("contract: capabilities —— provider 字段正确", () => {
  const a: ILLMClient = new AnthropicClient({ apiKey: "x", model: "x", transport: new FakeTransport() });
  const o: ILLMClient = new OpenAIClient({ apiKey: "x", model: "x", transport: new FakeTransport() });
  assertEquals(a.capabilities().provider, "anthropic");
  assertEquals(o.capabilities().provider, "openai");
  assert(a.capabilities().supportsTools);
});

Deno.test("contract: stream —— Anthropic 至少产出 done 事件", async () => {
  const t = new FakeTransport();
  t.streamResponse("https://api.anthropic.com/v1/messages", [
    { type: "message_start", message: { id: "m1", model: "x", usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ]);
  const c = new AnthropicClient({ apiKey: "x", model: "x", transport: t });
  const events = [];
  for await (const ev of c.stream(sampleRequest)) events.push(ev);
  assert(events.some((e) => e.type === "done"));
});

// 测试 fixture 文件也需要被 import；这里补个轻量引入
void ToolCallId;