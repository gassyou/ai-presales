/**
 * AI 对话面板前端类型
 */
import type { MessageRole } from "@shared/types/dto/ai-session.ts";

export interface ToolCallEntry {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
  readonly result?: string;
  readonly ok?: boolean;
  readonly error?: string;
  readonly durationMs?: number;
  /** 阶段 H+2：true = 等待用户在前端点批准/拒绝 */
  readonly awaitingApproval?: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** 阶段 5 接入：工具调用记录 */
  toolCalls?: ToolCallEntry[];
}