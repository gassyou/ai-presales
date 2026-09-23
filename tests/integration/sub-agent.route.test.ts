/**
 * /api/sub-agents 路由集成测试
 *
 * 不打真 LLM；用 FakeLLMClient 让 clientResolver 返回固定响应。
 */

import { assert, assertEquals } from "@std/assert";
import { handleSubAgents } from "@backend/presentation/routes/sub-agent.route.ts";
import type { SubAgentRouteDeps } from "@backend/presentation/routes/sub-agent.route.ts";
import { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { InMemorySubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import type {
  CanonicalAssistantMessage,
  ChatRequest,
  ChatResult,
  StreamEvent,
  ToolSpec,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
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

function makeAssistantMessage(text: string): CanonicalAssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: "fake",
  };
}

function makeFakeClient(text: string): ILLMClient {
  return {
    provider: "anthropic",
    async chat(_req: ChatRequest): Promise<ChatResult> {
      return { message: makeAssistantMessage(text) };
    },
    async *stream(_req: ChatRequest): AsyncIterable<StreamEvent> {
      yield { type: "chunk", delta: text, messageId: "fake" };
      yield { type: "done", messageId: "fake", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
    capabilities: () => ({
      provider: "anthropic",
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      contextWindow: 200_000,
    }),
  };
}

function makeDeps(opts?: { text?: string; agentName?: string; toolName?: string }): SubAgentRouteDeps {
  const text = opts?.text ?? "hello from fake";
  const agentName = opts?.agentName ?? "test-agent";
  const toolName = opts?.toolName ?? "current_datetime";

  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);

  const reg = new InMemorySubAgentRegistry();
  const r = SubAgentSpecVO.create({
    name: agentName,
    displayName: "Test",
    description: "x",
    systemPrompt: "you are test",
    toolNames: [toolName],
  });
  if (!r.ok) throw new Error(r.error.message);
  reg.register(r.value);

  return {
    logger: makeLogger(),
    registry: reg,
    toolRegistry: toolReg,
    clientResolver: () => makeFakeClient(text),
    cwd: Deno.cwd(),
    allowedPaths: [],
    defaultProfileName: "fast",
  };
}

Deno.test("GET /api/sub-agents —— 列出全部", async () => {
  const deps = makeDeps();
  const res = await handleSubAgents(new Request("http://x/api/sub-agents", { method: "GET" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { items: Array<{ name: string; displayName: string; toolNames: string[] }> };
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0].name, "test-agent");
  assertEquals(body.items[0].toolNames[0], "current_datetime");
});

Deno.test("POST /api/sub-agents/:name/invoke —— SSE 流式输出 chunk + done", async () => {
  const deps = makeDeps({ text: "ok" });
  const req = new Request("http://x/api/sub-agents/test-agent/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "hello" }),
  });
  const res = await handleSubAgents(req, deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const text = await res.text();
  assert(text.includes('"type":"chunk"'));
  assert(text.includes('"type":"done"'));
});

Deno.test("POST /api/sub-agents/:name/invoke —— 未知 name → 404", async () => {
  const deps = makeDeps();
  const req = new Request("http://x/api/sub-agents/nope/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "x" }),
  });
  const res = await handleSubAgents(req, deps);
  assertEquals(res.status, 404);
});

Deno.test("POST /api/sub-agents/:name/invoke —— 缺 input → 400", async () => {
  const deps = makeDeps();
  const req = new Request("http://x/api/sub-agents/test-agent/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await handleSubAgents(req, deps);
  assertEquals(res.status, 400);
});

Deno.test("POST /api/sub-agents/:name/invoke —— sub-agent 引用了未注册的 tool → 500", async () => {
  const deps = makeDeps({ agentName: "broken-agent", toolName: "missing_tool" });
  const req = new Request("http://x/api/sub-agents/broken-agent/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "x" }),
  });
  const res = await handleSubAgents(req, deps);
  assertEquals(res.status, 500);
  const body = await res.json() as { message: string };
  assert(body.message.includes("missing_tool"));
});

// 避免 unused 警告：ToolSpec 在类型注解里偶尔需要
void ({} as ToolSpec);