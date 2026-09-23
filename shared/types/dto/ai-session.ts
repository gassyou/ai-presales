/**
 * AI 会话 / 消息 DTO
 */

import type { IsoDateTime } from "../common.ts";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallDTO {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
  durationMs?: number;
}

export interface MessageDTO {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls: readonly ToolCallDTO[];
  inputTokens?: number;
  outputTokens?: number;
  createdAt: IsoDateTime;
}

export interface AiSessionDTO {
  id: string;
  projectId?: string;
  subAgentId?: string;
  title: string;
  status: "active" | "completed" | "aborted";
  messages: readonly MessageDTO[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  expireAt?: IsoDateTime;
}

export interface CreateSessionInput {
  projectId?: string;
  subAgentId?: string;
  title?: string;
}

export interface SendMessageInput {
  content: string;
  attachments?: readonly AttachmentInput[];
}

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  /** base64 编码的原始字节 */
  data: string;
}

/**
 * 流式事件 —— 与后端 backend/ai/message/canonical-message.ts StreamEvent 形状对齐
 *
 * 前端只关心 delta 文本 + done 信号；tool_call / tool_result 在阶段 5 接 tool UI。
 */
export type StreamEvent =
  | { readonly type: "chunk"; readonly delta: string; readonly messageId: string }
  | { readonly type: "tool_call"; readonly toolCallId: string; readonly name: string; readonly args: unknown }
  | { readonly type: "tool_result"; readonly toolCallId: string; readonly ok: boolean; readonly result?: unknown; readonly error?: string; readonly durationMs: number }
  | { readonly type: "done"; readonly messageId: string; readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number } }
  | { readonly type: "error"; readonly code: string; readonly message: string; readonly retryable: boolean }
  /** 阶段 7.4c：PPT 单页生成事件 */
  | { readonly type: "ppt_page"; readonly pageId: string; readonly ordinal: number; readonly title: string; readonly prompt: string; readonly model: string };