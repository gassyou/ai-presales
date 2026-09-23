/**
 * AiMessage —— 会话内消息值对象
 *
 * 设计：
 *   - immutable：append 后返回新值（不可变集合）
 *   - role 枚举：user / assistant / system / tool
 *   - toolCalls[] 与 citedMessageIds[]：工具调用链路 + 引用计分
 *   - content 可空（纯工具调用助手消息）；序列化用 toJSON
 *
 * 阶段 6 仅持久化文本与 toolCall 元数据；多模态后续阶段扩展。
 */

import type { MessageId, ProjectId, ToolCallId } from "@shared/types/ids.ts";
import { MessageId as toMessageId, ToolCallId as toToolCallId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import { domainErr, domainOk } from "../shared/result.ts";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface MessageToolCallSnapshot {
  readonly id: ToolCallId;
  readonly name: string;
  readonly args: unknown;
  readonly result?: unknown;
  readonly error?: string;
  readonly ok: boolean;
  readonly durationMs: number;
}

/**
 * 消息原始载荷 —— 来自调用方
 *
 * 注意：
 *   - sessionId 在 AiSession.appendMessage 路径下由聚合根强制注入；
 *     独立调用 AiMessage.create 时可省略（仅用于 rehydrate / 单元测试）
 */
export interface CreateMessageArgs {
  sessionId?: string;
  role: MessageRole;
  content: string;
  toolCalls?: readonly MessageToolCallSnapshot[];
  sourceProjectIds?: readonly ProjectId[];
  citedMessageIds?: readonly MessageId[];
  inputTokens?: number;
  outputTokens?: number;
  /** 测试用：固定 ID */
  id?: MessageId;
  createdAt?: Date;
}

export interface MessageSnapshot {
  id: MessageId;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls: readonly MessageToolCallSnapshot[];
  sourceProjectIds: readonly ProjectId[];
  citedMessageIds: readonly MessageId[];
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
}

/** 角色 → 合法消息序列规则（user/assistant 互相跟随；tool 必须跟在 assistant 后） */
const VALID_ROLES: ReadonlySet<MessageRole> = new Set(["user", "assistant", "system", "tool"]);

export class AiMessage {
  private constructor(
    private readonly _id: MessageId,
    private readonly _sessionId: string,
    private readonly _role: MessageRole,
    private readonly _content: string,
    private readonly _toolCalls: readonly MessageToolCallSnapshot[],
    private readonly _sourceProjectIds: readonly ProjectId[],
    private readonly _citedMessageIds: readonly MessageId[],
    private readonly _inputTokens: number | null,
    private readonly _outputTokens: number | null,
    private readonly _createdAt: Date,
  ) {}

  // ---------- factory ----------

  static create(args: CreateMessageArgs): DomainResult<AiMessage> {
    if (args.sessionId !== undefined && args.sessionId.trim().length === 0) {
      return domainErr("INVALID_INPUT", "sessionId cannot be empty");
    }
    if (!VALID_ROLES.has(args.role)) {
      return domainErr("INVALID_INPUT", `invalid role: ${args.role}`);
    }
    const toolCalls = args.toolCalls ?? [];
    if (args.role === "assistant" && args.content.length === 0 && toolCalls.length === 0) {
      return domainErr(
        "INVALID_INPUT",
        "assistant message must have either content or tool calls",
      );
    }
    // assistant 可以同时带 content（思考/解释）与 toolCalls（行动）；
    // 只有 role=user / assistant / system 不允许携带 toolCall 结果负载
    // （assistant 携带 tool_calls 视为"动作声明"，而 tool 携带 result 视为"动作回执"）
    if (args.role === "user" || args.role === "system") {
      if (toolCalls.length > 0) {
        return domainErr(
          "INVALID_INPUT",
          "user/system messages cannot carry tool call payloads",
          { role: args.role },
        );
      }
    }
    if (args.content.length > 200_000) {
      return domainErr("INVALID_INPUT", "message content too long (max 200000 chars)");
    }
    if (args.inputTokens !== undefined && args.inputTokens < 0) {
      return domainErr("INVALID_INPUT", "inputTokens cannot be negative");
    }
    if (args.outputTokens !== undefined && args.outputTokens < 0) {
      return domainErr("INVALID_INPUT", "outputTokens cannot be negative");
    }
    const id = args.id ?? toMessageId(crypto.randomUUID());
    return domainOk(
      new AiMessage(
        id,
        args.sessionId ?? "",
        args.role,
        args.content,
        toolCalls,
        args.sourceProjectIds ?? [],
        args.citedMessageIds ?? [],
        args.inputTokens ?? null,
        args.outputTokens ?? null,
        args.createdAt ?? new Date(),
      ),
    );
  }

  /**
   * 仓储重建 —— 信任持久层，fail-fast 在 rehydrate 处抛。
   * 这里仅做结构复制，不重新校验业务规则。
   */
  static rehydrate(snap: MessageSnapshot): AiMessage {
    return new AiMessage(
      snap.id,
      snap.sessionId,
      snap.role,
      snap.content,
      snap.toolCalls,
      snap.sourceProjectIds,
      snap.citedMessageIds,
      snap.inputTokens,
      snap.outputTokens,
      snap.createdAt,
    );
  }

  // ---------- getters ----------

  get id(): MessageId {
    return this._id;
  }
  get sessionId(): string {
    return this._sessionId;
  }
  get role(): MessageRole {
    return this._role;
  }
  get content(): string {
    return this._content;
  }
  get toolCalls(): readonly MessageToolCallSnapshot[] {
    return this._toolCalls;
  }
  get sourceProjectIds(): readonly ProjectId[] {
    return this._sourceProjectIds;
  }
  get citedMessageIds(): readonly MessageId[] {
    return this._citedMessageIds;
  }
  get inputTokens(): number | null {
    return this._inputTokens;
  }
  get outputTokens(): number | null {
    return this._outputTokens;
  }
  get createdAtValue(): Date {
    return this._createdAt;
  }

  snapshot(): MessageSnapshot {
    return {
      id: this._id,
      sessionId: this._sessionId,
      role: this._role,
      content: this._content,
      toolCalls: this._toolCalls,
      sourceProjectIds: this._sourceProjectIds,
      citedMessageIds: this._citedMessageIds,
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      createdAt: this._createdAt,
    };
  }
}

/**
 * 工具调用快照的 helper；tool 消息经常需要构造多个。
 */
export function makeToolCallSnapshot(args: {
  id?: ToolCallId;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
  ok: boolean;
  durationMs: number;
}): MessageToolCallSnapshot {
  return {
    id: args.id ?? toToolCallId(crypto.randomUUID()),
    name: args.name,
    args: args.args,
    result: args.result,
    error: args.error,
    ok: args.ok,
    durationMs: args.durationMs,
  };
}