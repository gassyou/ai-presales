/**
 * ChatWithToolsLoop 单元测试 —— 阶段 H
 *
 * 覆盖：
 *   - 单轮 end_turn：产出 chunk + done，无 tool_call
 *   - 多轮 + 1 个 tool_use：先 chunk，再 tool_call + tool_result，再 chunk + done
 *   - 工具失败：tool_result.ok = false，LLM 据此恢复
 *   - maxRounds 截断：到达上限时 done 结束
 *   - abort：调用前取消
 *   - pickToolSpecs：过滤未知 tool 名
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { chatWithToolsLoop, pickToolSpecs } from "@backend/ai/chat/chat-with-tools-loop.ts";
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
  const tools: ToolSpec[] = [{
    name: "current_datetime",
    description: currentDatetimeTool.description,
    inputSchema: currentDatetimeTool.inputSchema,
  }];
  return { client, executor, tools };
}

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

Deno.test("chatWithToolsLoop —— 单轮 end_turn", async () => {
  const { client, executor, tools } = makeSetup([{
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    stopReason: "end_turn",
    usage,
    model: "fake",
  }]);
  const events = await collect(chatWithToolsLoop({
    client,
    profile: { provider: "anthropic", model: "fake", temperature: 0, maxTokens: 100 },
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools,
    executor,
  }));
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "chunk");
  if (events[0].type === "chunk") assertEquals(events[0].delta, "hi");
  assertEquals(events[1].type, "done");
});

Deno.test("chatWithToolsLoop —— 多轮 1 个 tool_use 然后 done", async () => {
  const { client, executor, tools } = makeSetup([
    {
      role: "assistant",
      content: [
        { type: "text", text: "让我先查时间。" },
        { type: "tool_use", toolCallId: ToolCallId("tc-1"), name: "current_datetime", args: {} },
      ],
      stopReason: "tool_use",
      usage,
      model: "fake",
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "现在时间是 12:00。" }],
      stopReason: "end_turn",
      usage,
      model: "fake",
    },
  ]);
  const events = await collect(chatWithToolsLoop({
    client,
    profile: { provider: "anthropic", model: "fake", temperature: 0, maxTokens: 100 },
    messages: [{ role: "user", content: [{ type: "text", text: "现在几点？" }] }],
    tools,
    executor,
  }));

  // chunk "让我先查时间。" → tool_call tc-1 → tool_result → chunk "现在时间是 12:00。" → done
  assertEquals(events.length, 5);
  assertEquals(events[0].type, "chunk");
  assertEquals(events[1].type, "tool_call");
  assertEquals(events[2].type, "tool_result");
  assertEquals(events[3].type, "chunk");
  assertEquals(events[4].type, "done");
  if (events[2].type === "tool_result") {
    assertEquals(events[2].ok, true);
    assertEquals(events[2].toolCallId, ToolCallId("tc-1"));
  }
});

Deno.test("chatWithToolsLoop —— 工具未注册时 tool_result.ok = false，loop 不挂", async () => {
  const { client, executor, tools } = makeSetup([
    {
      role: "assistant",
      content: [
        { type: "tool_use", toolCallId: ToolCallId("tc-bad"), name: "no_such_tool", args: {} },
      ],
      stopReason: "tool_use",
      usage,
      model: "fake",
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "我没找到。" }],
      stopReason: "end_turn",
      usage,
      model: "fake",
    },
  ]);
  // 注意：tools 里只有 current_datetime，没有 no_such_tool；pickToolSpecs 之后 spec 列表里也没有。
  // 但 LLM 还是可能发出 tool_use name=no_such_tool（mock）。executor 应该回 ok=false。
  const events = await collect(chatWithToolsLoop({
    client,
    profile: { provider: "anthropic", model: "fake", temperature: 0, maxTokens: 100 },
    messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    tools,
    executor,
  }));
  // 第一轮只有 tool_use、无文本 → 直接 tool_call → tool_result → 第二轮 chunk "我没找到。" → done
  assertEquals(events.length, 4);
  assertEquals(events[0].type, "tool_call");
  if (events[0].type === "tool_call") assertEquals(events[0].name, "no_such_tool");
  assertEquals(events[1].type, "tool_result");
  if (events[1].type === "tool_result") assertEquals(events[1].ok, false);
  assertEquals(events[2].type, "chunk");
  assertEquals(events[3].type, "done");
});

Deno.test("chatWithToolsLoop —— maxRounds 截断：连发 tool_use 达到上限 → done with max-rounds", async () => {
  const { client, executor, tools } = makeSetup([
    {
      role: "assistant",
      content: [{ type: "tool_use", toolCallId: ToolCallId("t1"), name: "current_datetime", args: {} }],
      stopReason: "tool_use",
      usage,
      model: "fake",
    },
    {
      role: "assistant",
      content: [{ type: "tool_use", toolCallId: ToolCallId("t2"), name: "current_datetime", args: {} }],
      stopReason: "tool_use",
      usage,
      model: "fake",
    },
  ]);
  const events = await collect(chatWithToolsLoop({
    client,
    profile: { provider: "anthropic", model: "fake", temperature: 0, maxTokens: 100 },
    messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    tools,
    executor,
    maxRounds: 2,
  }));
  // 第一轮：tool_call + tool_result；第二轮：tool_call + tool_result；超出 maxRounds → done
  const dones = events.filter((e) => e.type === "done");
  assertEquals(dones.length, 1);
  if (dones[0].type === "done") assertEquals(dones[0].messageId, "max-rounds");
});

Deno.test("chatWithToolsLoop —— abort 立即 error", async () => {
  const controller = new AbortController();
  controller.abort();
  const { client, executor, tools } = makeSetup([]);
  const events = await collect(chatWithToolsLoop({
    client,
    profile: { provider: "anthropic", model: "fake", temperature: 0, maxTokens: 100 },
    messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    tools,
    executor,
    signal: controller.signal,
  }));
  assertEquals(events.length, 1);
  assertEquals(events[0].type, "error");
  if (events[0].type === "error") assertEquals(events[0].code, "ABORTED");
});

Deno.test("pickToolSpecs —— 过滤未知 tool 名 + 正确映射字段", () => {
  const reg = new ToolRegistry();
  reg.register(currentDatetimeTool);
  const specs = pickToolSpecs(reg, ["current_datetime", "missing_tool"]);
  assertEquals(specs.length, 1);
  assertEquals(specs[0].name, "current_datetime");
  assert(typeof specs[0].description === "string" && specs[0].description.length > 0);
  assert(specs[0].inputSchema);
});