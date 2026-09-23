/**
 * 规范消息 —— LLM 客户端抽象的核心类型
 *
 * 设计目的：让 OpenAI / Anthropic 适配器都有同一个内部消息模型，
 *          mapper 把 canonical ↔ provider-specific 互转。
 *
 * 任何 chat 请求/响应都流过 canonical：
 *   - chat 路由           → 构造 CanonicalMessage[] → 调 ILLMClient
 *   - 适配器内部          → 把 CanonicalMessage 映射到 provider schema
 *   - 流式事件            → 在合约层归一化为 StreamEvent
 */

import type { ProjectId, AiSessionId, MessageId, ToolCallId } from "@shared/types/ids.ts";

export type CanonicalRole = "system" | "user" | "assistant" | "tool";

export interface CanonicalTextPart {
  readonly type: "text";
  readonly text: string;
}

export interface CanonicalToolUsePart {
  readonly type: "tool_use";
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly args: unknown;
}

export interface CanonicalToolResultPart {
  readonly type: "tool_result";
  readonly toolCallId: ToolCallId;
  readonly content: string;
  readonly isError: boolean;
}

export type CanonicalContentPart =
  | CanonicalTextPart
  | CanonicalToolUsePart
  | CanonicalToolResultPart;

export interface CanonicalMessage {
  readonly role: CanonicalRole;
  /** 文本或多段；助手消息可以同时包含 text + tool_use */
  readonly content: readonly CanonicalContentPart[];
  /** 仅 message 的名字，用于回放 / 关联；非 SDK 必填 */
  readonly name?: string;
  /** 来源业务 ID；adapter 不强求 */
  readonly sourceId?: MessageId;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 适配器对外吐出的规范化消息（chat 完成态） */
export interface CanonicalAssistantMessage {
  readonly role: "assistant";
  readonly content: readonly CanonicalContentPart[];
  readonly stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | "unknown";
  readonly usage: ChatUsage;
  readonly model: string;
}

/** ChatRequest —— 输入契约 */
export interface ChatRequest {
  readonly systemPrompt?: string;
  readonly messages: readonly CanonicalMessage[];
  readonly model: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** 可用工具；adapter 决定怎么交给 prompt 助手 */
  readonly tools?: readonly ToolSpec[];
  /** 取消信号 */
  readonly signal?: AbortSignal;
  /** 调用方上下文（仅日志用） */
  readonly context?: {
    readonly projectId?: ProjectId;
    readonly sessionId?: AiSessionId;
  };
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;    // JSON Schema
}

/** ChatResult —— 同步 chat 的返回 */
export interface ChatResult {
  readonly message: CanonicalAssistantMessage;
  readonly raw?: unknown;        // 适配器原始响应，给日志/审计
}

/** 流式 chunk —— 阶段 4 用；阶段 3 先支持 chat 同步路径 */
export type StreamEvent =
  | { readonly type: "chunk"; readonly delta: string; readonly messageId: string }
  | { readonly type: "tool_call"; readonly toolCallId: ToolCallId; readonly name: string; readonly args: unknown }
  | { readonly type: "tool_result"; readonly toolCallId: ToolCallId; readonly ok: boolean; readonly result?: unknown; readonly error?: string; readonly durationMs: number }
  | { readonly type: "done"; readonly messageId: string; readonly usage: ChatUsage }
  | { readonly type: "error"; readonly code: string; readonly message: string; readonly retryable: boolean }
  /** 阶段 7.4c：PPT 单页生成事件（流式逐页贴入） */
  | { readonly type: "ppt_page"; readonly pageId: string; readonly ordinal: number; readonly title: string; readonly prompt: string; readonly model: string };

/** 适配器能力描述 —— 用于决定要不要降级 */
export interface ProviderCapabilities {
  readonly provider: "openai" | "anthropic";
  readonly supportsTools: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly contextWindow: number;
}