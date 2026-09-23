/**
 * SubAgentRunner —— 多轮 tool-use 循环
 *
 * 流程：
 *   1. 用 spec.systemPrompt + 用户输入构造 messages
 *   2. 调 client.chat(req) → CanonicalAssistantMessage
 *   3. 若有 tool_use parts → 串 tool-executor → 把结果作为 `tool` role 追加 → 继续
 *   4. 终止：end_turn / max_tokens / maxRounds / abort
 *
 * 输出 AsyncIterable<StreamEvent>：chunk / tool_call / tool_result / done / error
 * SSE 复用阶段 4 的 buildSseResponse。
 */

import type { ILLMClient } from "../client/llm-client.ts";
import type { ToolExecutor } from "../tool/tool-executor.ts";
import type {
  CanonicalAssistantMessage,
  CanonicalContentPart,
  CanonicalMessage,
  ChatRequest,
  StreamEvent,
  ToolSpec,
} from "../message/canonical-message.ts";
import { ToolCallId } from "@shared/types/ids.ts";
import type { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import type { ToolInvocation } from "../tool/tool.ts";

export interface SubAgentRunnerDeps {
  readonly client: ILLMClient;
  readonly executor: ToolExecutor;
  readonly maxRounds?: number;
  /**
   * 阶段 7.4h：返回当前默认 profile 快照（settings 改了后下一次 invoke 自动用新值）。
   * 不传则使用默认 fallback（temperature=0.5 / maxOutputTokens=4096）。
   */
  readonly profileSnapshot?: () => ProfileSnapshot | undefined;
}

/** 从 LLM profile 取出来的运行时配置快照 */
export interface ProfileSnapshot {
  readonly temperature: number;
  readonly maxTokens: number;
}

export interface SubAgentRunInput {
  readonly spec: SubAgentSpecVO;
  readonly userInput: string;
  /** 既有的对话历史（用于多轮；首轮可省） */
  readonly history?: readonly CanonicalMessage[];
  readonly tools: readonly ToolSpec[];
  readonly signal?: AbortSignal;
}

export class SubAgentRunner {
  constructor(private readonly deps: SubAgentRunnerDeps) {}

  async *run(input: SubAgentRunInput): AsyncIterable<StreamEvent> {
    const maxRounds = this.deps.maxRounds ?? 10;
    const messages: CanonicalMessage[] = [
      ...(input.history ?? []),
      { role: "user", content: [{ type: "text", text: input.userInput }] },
    ];

    for (let round = 0; round < maxRounds; round++) {
      if (input.signal?.aborted) {
        yield { type: "error", code: "ABORTED", message: "aborted by user", retryable: false };
        return;
      }

      const profile = this.deps.profileSnapshot?.();
      const req: ChatRequest = {
        systemPrompt: input.spec.systemPrompt,
        messages,
        model: input.spec.profileHint ?? "default",
        temperature: profile?.temperature ?? 0.5,
        maxOutputTokens: profile?.maxTokens ?? 4096,
        tools: input.tools,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      };

      let asst: CanonicalAssistantMessage;
      try {
        const result = await this.deps.client.chat(req);
        asst = result.message;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        yield {
          type: "error",
          code: "LLM_INTERNAL",
          message: msg,
          retryable: true,
        };
        return;
      }

      // 收集文本片段
      const text = asst.content
        .filter((p): p is Extract<CanonicalContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text.length > 0) {
        yield { type: "chunk", delta: text, messageId: asst.model };
      }

      // 收集 tool_use
      const toolUses = asst.content.filter(
        (p): p is Extract<CanonicalContentPart, { type: "tool_use" }> => p.type === "tool_use",
      );

      // 把 assistant 消息塞回 history
      messages.push({ role: "assistant", content: asst.content });

      if (toolUses.length === 0 || asst.stopReason === "end_turn" || asst.stopReason === "max_tokens" || asst.stopReason === "stop") {
        yield {
          type: "done",
          messageId: asst.model,
          usage: asst.usage,
        };
        return;
      }

      // 执行工具 → 写回 tool role messages
      const invocations: ToolInvocation[] = toolUses.map((tu) => ({
        toolCallId: tu.toolCallId,
        name: tu.name,
        args: tu.args,
      }));
      const outcomes = await this.deps.executor.executeAll(invocations);

      for (const tu of toolUses) {
        yield {
          type: "tool_call",
          toolCallId: tu.toolCallId,
          name: tu.name,
          args: tu.args,
        };
      }
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
    }

    // maxRounds 截断
    yield {
      type: "error",
      code: "MAX_ROUNDS_EXCEEDED",
      message: `sub-agent exceeded max rounds (${maxRounds})`,
      retryable: false,
    };
  }
}

/** 避免 unused 警告：ToolCallId brand 在映射时偶尔需要 */
void ToolCallId;