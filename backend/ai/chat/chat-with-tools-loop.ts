/**
 * ChatWithToolsLoop —— 阶段 H
 *
 * 把 SubAgentRunner 的核心"agent loop"抽出来，让普通 /api/ai/chat 也能用：
 *   - 用户消息 + systemPrompt + tools
 *   - 多轮 LLM chat：每次 client.chat(req)，解析 tool_use；如有则执行 tool；
 *     把结果塞回 messages；再 chat；直到没有 tool_use 或达 maxRounds
 *   - 流式输出：把每轮的 text chunk 透传 + tool_call/tool_result 事件喂给 SSE 消费者
 *
 * 与 SubAgentRunner 的差异：
 *   - 不需要 sub-agent spec（chat 自己给 systemPrompt）
 *   - 不需要 SubAgentRegistry
 *   - systemPrompt 由调用方传
 *   - 工具列表直接是 ToolSpec[]（调用方已 from registry）
 */

import type {
  CanonicalAssistantMessage,
  CanonicalContentPart,
  CanonicalMessage,
  ChatRequest,
  ToolSpec,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";
import type { IToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { ToolContext, ToolInvocation, ToolOutcome } from "@backend/ai/tool/tool.ts";
import type { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export interface ChatWithToolsLoopInput {
  readonly client: ILLMClient;
  readonly profile: ProfileConfig;
  readonly messages: readonly CanonicalMessage[];
  readonly systemPrompt?: string;
  readonly tools: readonly ToolSpec[];
  readonly executor: ToolExecutor;
  readonly signal?: AbortSignal;
  readonly maxRounds?: number;
  readonly logger?: Logger;
}

export interface ChatWithToolsLoopDeps {
  readonly client: ILLMClient;
  readonly profile: ProfileConfig;
  readonly executor: ToolExecutor;
  readonly toolRegistry: IToolRegistry;
  readonly logger: Logger;
  readonly cwd: string;
  readonly allowedPaths: readonly string[];
  readonly defaultTimeoutMs?: number;
}

export async function* chatWithToolsLoop(
  input: ChatWithToolsLoopInput,
): AsyncIterable<StreamEvent> {
  const messages: CanonicalMessage[] = [...input.messages];
  const maxRounds = input.maxRounds ?? 5;
  const log = input.logger;

  for (let round = 0; round < maxRounds; round++) {
    if (input.signal?.aborted) {
      yield { type: "error", code: "ABORTED", message: "aborted by user", retryable: false };
      return;
    }

    const req: ChatRequest = {
      systemPrompt: input.systemPrompt,
      messages,
      model: input.profile.model,
      temperature: input.profile.temperature,
      maxOutputTokens: input.profile.maxTokens,
      tools: input.tools.length > 0 ? input.tools : undefined,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    };

    let asst: CanonicalAssistantMessage;
    try {
      const result = await input.client.chat(req);
      asst = result.message;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      yield { type: "error", code: "LLM_INTERNAL", message: msg, retryable: true };
      return;
    }

    // 把 assistant 消息塞回 history
    messages.push({ role: "assistant", content: asst.content });

    // 流式吐文本
    const text = asst.content
      .filter((p): p is Extract<CanonicalContentPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (text.length > 0) {
      yield { type: "chunk", delta: text, messageId: asst.model };
    }

    // 收 tool_use
    const toolUses = asst.content.filter(
      (p): p is Extract<CanonicalContentPart, { type: "tool_use" }> => p.type === "tool_use",
    );

    if (toolUses.length === 0 || asst.stopReason === "end_turn" || asst.stopReason === "stop") {
      yield { type: "done", messageId: asst.model, usage: asst.usage };
      return;
    }

    // 执行 tool → tool_result part
    const invocations: ToolInvocation[] = toolUses.map((tu) => ({
      toolCallId: tu.toolCallId,
      name: tu.name,
      args: tu.args,
    }));

    // 流式先 yield tool_call 事件（让前端立刻能看到）
    for (const tu of toolUses) {
      yield {
        type: "tool_call",
        toolCallId: tu.toolCallId,
        name: tu.name,
        args: tu.args,
      };
    }

    const outcomes: ToolOutcome[] = await input.executor.executeAll(invocations);
    for (const o of outcomes) {
      yield {
        type: "tool_result",
        toolCallId: o.toolCallId,
        ok: o.ok,
        ...(o.error !== undefined ? { error: o.error } : {}),
        ...(o.ok ? { result: o.content } : {}),
        durationMs: o.durationMs,
      };
    }

    const toolParts: CanonicalContentPart[] = outcomes.map((o) => ({
      type: "tool_result",
      toolCallId: o.toolCallId,
      content: o.ok ? o.content : `ERROR: ${o.error ?? "unknown"}`,
      isError: !o.ok,
    }));
    messages.push({ role: "tool", content: toolParts });

    // max_tokens 终止
    if (asst.stopReason === "max_tokens") {
      yield { type: "done", messageId: asst.model, usage: asst.usage };
      return;
    }
  }

  // 超过 maxRounds
  if (log) log.warn("chat-tools loop hit maxRounds", { maxRounds });
  yield { type: "done", messageId: "max-rounds", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
}

/** 工具工厂：把 toolNames 数组 → ToolSpec[]（从 registry 取） */
export function pickToolSpecs(
  registry: IToolRegistry,
  toolNames: readonly string[],
): ToolSpec[] {
  const out: ToolSpec[] = [];
  for (const name of toolNames) {
    const tool = registry.get(name);
    if (!tool) continue;
    out.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
  }
  return out;
}