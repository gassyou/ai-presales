/**
 * ContextAwareSubAgentRunner —— 带上下文装配 + 持久化的 sub-agent 运行器
 *
 * 在现有 SubAgentRunner 之上包一层：
 *   1. 入口：ContextAssembler.assemble() 拿系统 prompt + 历史 messages
 *   2. 把它们喂给底层 SubAgentRunner（替换它自己拼的 spec.systemPrompt + history）
 *   3. 流式产出过程中累加 assistant 文本 + tool_calls；end_turn 后调 IAiSessionRepository.save 持久化
 *   4. tool message 也跟着持久化
 *   5. abort / error 时把 session 状态切到 aborted
 *
 * 为什么不直接改 SubAgentRunner：
 *   - 现有 4 个单元测试用 fake client 验证 tool-use 循环，不希望被引入"必须装配上下文"的隐含依赖
 *   - 让"是否用 ContextAssembler"成为可选依赖（deps.assembler 可省；省了就走原 spec.systemPrompt）
 *
 * 依赖（按需注入；都不传则等价于 SubAgentRunner）：
 *   - assembler：ContextAssembler；省了就用 spec.systemPrompt + userInput 直接喂
 *   - sessionFactory：创建 AiSession + 调 appendMessage；省了就不持久化
 *   - projectId：决定 session.projectId
 *   - citedMessageIds：本次输入引用了哪些历史消息（采纳计分用）
 *   - sourceProjectIds：本次输入涉及的 @ 项目（审计用）
 */

import type { ProjectId, MessageId } from "@shared/types/ids.ts";
import type {
  CanonicalContentPart,
  CanonicalMessage,
  ChatRequest,
  StreamEvent,
  ToolSpec,
  ChatUsage,
} from "../message/canonical-message.ts";
import type { ContextAssembler, ContextAssemblerInput } from "../context/context-assembler.ts";
import type { ILLMClient } from "../client/llm-client.ts";
import type { ToolExecutor } from "../tool/tool-executor.ts";
import type { ToolInvocation, ToolOutcome } from "../tool/tool.ts";
import type { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { AiSession } from "@backend/domain/ai-session/ai-session.ts";
import { makeToolCallSnapshot } from "@backend/domain/ai-session/message.ts";
import type { IAiSessionRepository } from "@backend/domain/ai-session/ai-session.repository.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import { ToolCallId } from "@shared/types/ids.ts";
import type { ProfileSnapshot } from "./sub-agent-runner.ts";

export interface ContextAwareRunnerDeps {
  readonly client: ILLMClient;
  readonly executor: ToolExecutor;
  /** Context 装配器；不传则用 spec.systemPrompt */
  readonly assembler?: ContextAssembler;
  /** AI session 仓储；不传则不持久化 */
  readonly sessionRepo?: IAiSessionRepository;
  /** 时钟 */
  readonly clock: Clock;
  readonly maxRounds?: number;
  /** 当前项目（自动绑定）；不传则 session.projectId = null */
  readonly projectId?: ProjectId | null;
  /** 会话标题（持久化用） */
  readonly sessionTitle?: string;
  /** 本次输入涉及的 @ 项目（审计） */
  readonly sourceProjectIds?: readonly ProjectId[];
  /** 本次输入引用了哪些历史消息（采纳计分） */
  readonly citedMessageIds?: readonly MessageId[];
  /**
   * 阶段 7.4h：返回当前默认 profile 快照（settings 改了后下一次 invoke 自动用新值）。
   * 不传则使用默认 fallback（temperature=0.5 / maxOutputTokens=4096）。
   */
  readonly profileSnapshot?: () => ProfileSnapshot | undefined;
}

export interface ContextAwareRunInput {
  readonly spec: SubAgentSpecVO;
  readonly userInput: string;
  /** 既有的对话历史（ContextAssembler 装配前会再次整理） */
  readonly history?: readonly CanonicalMessage[];
  readonly tools: readonly ToolSpec[];
  readonly signal?: AbortSignal;
  /** 预算配置（默认 200K - 8K） */
  readonly budget?: { contextWindow: number; maxOutputTokens: number };
}

interface DraftAssistant {
  text: string;
  toolUses: Array<{ id: string; name: string; args: unknown }>;
  usage: ChatUsage | null;
}

interface DraftTool {
  results: Array<ToolOutcome>;
}

const DEFAULT_BUDGET = { contextWindow: 200_000, maxOutputTokens: 8_192 } as const;

export class ContextAwareSubAgentRunner {
  constructor(private readonly deps: ContextAwareRunnerDeps) {}

  async *run(input: ContextAwareRunInput): AsyncIterable<StreamEvent> {
    // 1) 装配上下文
    const budget = input.budget ?? DEFAULT_BUDGET;
    let systemPrompt = input.spec.systemPrompt;
    let assembledMessages: readonly CanonicalMessage[] = [];
    let sources: readonly { kind: string; projectId?: string; module?: string }[] = [];

    if (this.deps.assembler) {
      const assemblerInput: ContextAssemblerInput = {
        baseSystemPrompt: input.spec.systemPrompt,
        ...(this.deps.projectId !== undefined && this.deps.projectId !== null ? { projectId: this.deps.projectId } : {}),
        userInput: input.userInput,
        recentMessages: input.history ?? [],
        budget,
        projectLookup: async () => null, // 6.0d 的真实 lookup 由 SubAgentRoute 层注入；此处只做装配核心
      };
      const ctx = await this.deps.assembler.assemble(assemblerInput);
      systemPrompt = ctx.systemPrompt;
      assembledMessages = ctx.messages;
      sources = ctx.sources;
    } else {
      assembledMessages = [
        ...(input.history ?? []),
        { role: "user", content: [{ type: "text", text: input.userInput }] },
      ];
    }

    // 2) 建 session（如果有 sessionRepo）
    let session: AiSession | null = null;
    if (this.deps.sessionRepo) {
      const r = AiSession.create({
        ...(this.deps.projectId !== undefined && this.deps.projectId !== null ? { projectId: this.deps.projectId } : {}),
        subAgentName: input.spec.name,
        title: this.deps.sessionTitle ?? input.spec.name,
        clock: this.deps.clock,
      });
      if (!r.ok) {
        yield { type: "error", code: "INTERNAL", message: r.error.message, retryable: false };
        return;
      }
      session = r.value;
      // user message
      session.appendMessage(
        {
          role: "user",
          content: input.userInput,
          ...(this.deps.sourceProjectIds ? { sourceProjectIds: this.deps.sourceProjectIds } : {}),
          ...(this.deps.citedMessageIds ? { citedMessageIds: this.deps.citedMessageIds } : {}),
        },
        this.deps.clock,
      );
      const saveRes = await this.deps.sessionRepo.save(session);
      if (!saveRes.ok) {
        yield { type: "error", code: "INTERNAL", message: saveRes.error.message, retryable: false };
        return;
      }
    }

    // 3) 多轮 tool-use 循环
    const maxRounds = this.deps.maxRounds ?? 10;
    const messages: CanonicalMessage[] = [...assembledMessages];

    for (let round = 0; round < maxRounds; round++) {
      if (input.signal?.aborted) {
        if (session) {
          session.abort("aborted by user", this.deps.clock);
          await this.deps.sessionRepo?.save(session);
        }
        yield { type: "error", code: "ABORTED", message: "aborted by user", retryable: false };
        return;
      }

      const profile = this.deps.profileSnapshot?.();
      const req: ChatRequest = {
        systemPrompt,
        messages,
        model: input.spec.profileHint ?? "default",
        temperature: profile?.temperature ?? 0.5,
        maxOutputTokens: profile?.maxTokens ?? 4096,
        tools: input.tools,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      };

      let asst;
      try {
        const result = await this.deps.client.chat(req);
        asst = result.message;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (session) {
          session.abort(`LLM error: ${msg}`, this.deps.clock);
          await this.deps.sessionRepo?.save(session);
        }
        yield { type: "error", code: "LLM_INTERNAL", message: msg, retryable: true };
        return;
      }

      // 累加本轮 assistant
      const draftAssistant: DraftAssistant = {
        text: asst.content
          .filter((p): p is Extract<CanonicalContentPart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join(""),
        toolUses: asst.content
          .filter((p): p is Extract<CanonicalContentPart, { type: "tool_use" }> => p.type === "tool_use")
          .map((p) => ({ id: p.toolCallId, name: p.name, args: p.args })),
        usage: asst.usage,
      };

      // 输出文本 chunk
      if (draftAssistant.text.length > 0) {
        yield { type: "chunk", delta: draftAssistant.text, messageId: asst.model };
      }

      // 把 assistant 消息塞回 history
      messages.push({ role: "assistant", content: asst.content });

      const terminal =
        draftAssistant.toolUses.length === 0 ||
        asst.stopReason === "end_turn" ||
        asst.stopReason === "max_tokens" ||
        asst.stopReason === "stop";

      if (terminal) {
        // 持久化 assistant
        if (session) {
          session.appendMessage(
            {
              role: "assistant",
              content: draftAssistant.text,
              toolCalls: draftAssistant.toolUses.map((tu) =>
                makeToolCallSnapshot({
                  id: ToolCallId(tu.id),
                  name: tu.name,
                  args: tu.args,
                  ok: true,
                  durationMs: 0,
                })
              ),
              ...(draftAssistant.usage ? { inputTokens: draftAssistant.usage.inputTokens, outputTokens: draftAssistant.usage.outputTokens } : {}),
            },
            this.deps.clock,
          );
          session.complete(this.deps.clock);
          await this.deps.sessionRepo?.save(session);
        }
        yield { type: "done", messageId: asst.model, usage: asst.usage };
        return;
      }

      // 执行 tool → 持久化
      const invocations: ToolInvocation[] = draftAssistant.toolUses.map((tu) => ({
        toolCallId: ToolCallId(tu.id),
        name: tu.name,
        args: tu.args,
      }));
      const outcomes = await this.deps.executor.executeAll(invocations);
      const draftTool: DraftTool = { results: [...outcomes] };

      for (const tu of draftAssistant.toolUses) {
        yield { type: "tool_call", toolCallId: ToolCallId(tu.id), name: tu.name, args: tu.args };
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

      if (session) {
        const toolCalls = draftAssistant.toolUses.map((tu, i) => {
          const outcome = outcomes.find((o) => o.toolCallId === tu.id);
          return makeToolCallSnapshot({
            id: ToolCallId(tu.id),
            name: tu.name,
            args: tu.args,
            result: outcome?.content,
            error: outcome?.error,
            ok: outcome?.ok ?? false,
            durationMs: outcome?.durationMs ?? 0,
          });
        });
        // assistant 消息带 tool_calls
        session.appendMessage(
          {
            role: "assistant",
            content: draftAssistant.text,
            toolCalls,
          },
          this.deps.clock,
        );
        // tool 消息
        const toolParts: CanonicalContentPart[] = outcomes.map((o) => ({
          type: "tool_result" as const,
          toolCallId: o.toolCallId,
          content: o.ok ? o.content : `ERROR: ${o.error ?? "unknown"}`,
          isError: !o.ok,
        }));
        session.appendMessage(
          {
            role: "tool",
            content: "", // tool 消息正文为空元数据；真实 payload 在 toolCalls[].result 里
            toolCalls,
          },
          this.deps.clock,
        );
        const saveRes = await this.deps.sessionRepo?.save(session);
        if (saveRes && !saveRes.ok) {
          yield { type: "error", code: "INTERNAL", message: saveRes.error.message, retryable: false };
          return;
        }
        void toolParts;
        void draftTool;
      }

      // tool 结果塞回 messages
      const toolParts: CanonicalContentPart[] = outcomes.map((o) => ({
        type: "tool_result",
        toolCallId: o.toolCallId,
        content: o.ok ? o.content : `ERROR: ${o.error ?? "unknown"}`,
        isError: !o.ok,
      }));
      messages.push({ role: "tool", content: toolParts });
    }

    // maxRounds 截断
    if (session) {
      session.abort("MAX_ROUNDS_EXCEEDED", this.deps.clock);
      await this.deps.sessionRepo?.save(session);
    }
    yield {
      type: "error",
      code: "MAX_ROUNDS_EXCEEDED",
      message: `sub-agent exceeded max rounds`,
      retryable: false,
    };
  }
}