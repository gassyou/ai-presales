/**
 * SubAgentRunner 单元测试
 *
 * 用 FakeLLMClient 替换 ILLMClient：按调用次数返回不同 response。
 */

import { assert, assertEquals } from "@std/assert";
import { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { SubAgentRunner } from "@backend/ai/sub-agent/sub-agent-runner.ts";
import type {
  CanonicalAssistantMessage,
  ChatRequest,
  ChatResult,
  StreamEvent,
  ToolSpec,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ProviderCapabilities } from "@backend/ai/message/canonical-message.ts";
import { ToolCallId } from "@shared/types/ids.ts";
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

class FakeLLMClient implements ILLMClient {
  readonly provider = "anthropic" as const;
  /** 第 N 次 chat 返回的内容（0-indexed） */
  constructor(private readonly responses: CanonicalAssistantMessage[]) {}
  private callCount = 0;

  async chat(_req: ChatRequest): Promise<ChatResult> {
    const r = this.responses[this.callCount++];
    if (!r) throw new Error(`FakeLLMClient: no response for call #${this.callCount}`);
    return { message: r };
  }
  async *stream(_req: ChatRequest): AsyncIterable<StreamEvent> {
    throw new Error("not used");
  }
  capabilities(): ProviderCapabilities {
    return {
      provider: "anthropic",
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      contextWindow: 200_000,
    };
  }
}

function makeSpec() {
  const r = SubAgentSpecVO.create({
    name: "test-agent",
    displayName: "Test",
    description: "x",
    systemPrompt: "You are a test agent.",
    toolNames: ["current_datetime"],
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makeSetup(responses: CanonicalAssistantMessage[]) {
  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [],
    defaultTimeoutMs: 5000,
  });
  const client = new FakeLLMClient(responses);
  const runner = new SubAgentRunner({ client, executor });
  const tools: ToolSpec[] = [{
    name: "current_datetime",
    description: currentDatetimeTool.description,
    inputSchema: currentDatetimeTool.inputSchema,
  }];
  return { runner, tools };
}

Deno.test("SubAgentRunner —— 单轮 end_turn：yield chunk + done，0 tool_call", async () => {
  const { runner, tools } = makeSetup([{
    role: "assistant",
    content: [{ type: "text", text: "你好！" }],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: "fake",
  }]);
  const events: StreamEvent[] = [];
  for await (const ev of runner.run({ spec: makeSpec(), userInput: "hi", tools })) {
    events.push(ev);
  }
  const chunks = events.filter((e) => e.type === "chunk");
  const dones = events.filter((e) => e.type === "done");
  const toolCalls = events.filter((e) => e.type === "tool_call");
  assertEquals(chunks.length, 1);
  assertEquals((chunks[0] as { delta: string }).delta, "你好！");
  assertEquals(dones.length, 1);
  assertEquals(toolCalls.length, 0);
});

Deno.test("SubAgentRunner —— tool_use → 执行 → 第二轮 end_turn：emit tool_call + tool_result + chunk + done", async () => {
  const { runner, tools } = makeSetup([
    // 第一轮：assistant 调 current_datetime
    {
      role: "assistant",
      content: [{
        type: "tool_use",
        toolCallId: ToolCallId("toolu_1"),
        name: "current_datetime",
        args: { timezone: "UTC" },
      }],
      stopReason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: "fake",
    },
    // 第二轮：拿到 tool_result 后回话
    {
      role: "assistant",
      content: [{ type: "text", text: "现在 UTC 时间已查到。" }],
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      model: "fake",
    },
  ]);
  const events: StreamEvent[] = [];
  for await (const ev of runner.run({ spec: makeSpec(), userInput: "几点了", tools })) {
    events.push(ev);
  }
  const toolCalls = events.filter((e) => e.type === "tool_call");
  const toolResults = events.filter((e) => e.type === "tool_result");
  const chunks = events.filter((e) => e.type === "chunk");
  const dones = events.filter((e) => e.type === "done");
  assertEquals(toolCalls.length, 1);
  assertEquals(toolResults.length, 1);
  assertEquals((toolResults[0] as { ok: boolean }).ok, true);
  assertEquals(chunks.length, 1);
  assertEquals(dones.length, 1);
});

Deno.test("SubAgentRunner —— 异常 LLM → yield error 事件", async () => {
  class BoomClient extends FakeLLMClient {
    override async chat(): Promise<ChatResult> {
      throw new Error("upstream down");
    }
  }
  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [],
    defaultTimeoutMs: 5000,
  });
  const runner = new SubAgentRunner({ client: new BoomClient([]), executor });
  const events: StreamEvent[] = [];
  for await (const ev of runner.run({
    spec: makeSpec(),
    userInput: "hi",
    tools: [{
      name: "current_datetime",
      description: currentDatetimeTool.description,
      inputSchema: currentDatetimeTool.inputSchema,
    }],
  })) {
    events.push(ev);
  }
  const errs = events.filter((e) => e.type === "error");
  assertEquals(errs.length, 1);
  assertEquals((errs[0] as { code: string }).code, "LLM_INTERNAL");
});

Deno.test("SubAgentRunner —— 超过 maxRounds 截断 → error MAX_ROUNDS_EXCEEDED", async () => {
  // 永远不停（持续 tool_use）
  const forever: CanonicalAssistantMessage = {
    role: "assistant",
    content: [{
      type: "tool_use",
      toolCallId: ToolCallId("loop"),
      name: "current_datetime",
      args: {},
    }],
    stopReason: "tool_use",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: "fake",
  };
  const { runner, tools } = makeSetup(Array(20).fill(forever));
  const events: StreamEvent[] = [];
  for await (const ev of runner.run({ spec: makeSpec(), userInput: "loop", tools })) {
    events.push(ev);
  }
  // 末尾应该是 error 类型，code = MAX_ROUNDS_EXCEEDED
  const last = events[events.length - 1];
  assert(last.type === "error");
  assertEquals((last as { code: string }).code, "MAX_ROUNDS_EXCEEDED");
});