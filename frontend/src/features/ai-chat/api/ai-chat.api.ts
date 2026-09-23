/**
 * AI Chat API —— 后端 AI 端点封装
 *
 * - chat()         同步（POST /api/ai/chat）
 * - streamChat()   流式（POST /api/ai/chat/stream）
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { postSse, readSse } from "@frontend/shared/api/sse-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";
import type { StreamEvent } from "@shared/types/dto/ai-session.ts";

export interface ChatContentPart {
  type: "text" | "tool_use";
  text?: string;
  toolCallId?: string;
  name?: string;
  args?: unknown;
}

export interface ChatResponse {
  content: ChatContentPart[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | "unknown";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
}

export interface ChatRequestBody {
  profile: string;
  systemPrompt?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** 阶段 6.0f：当前绑定项目（自动带入 ContextAssembler） */
  projectId?: string;
}

export const aiChatApi = {
  chat(body: ChatRequestBody) {
    return http.post<ChatResponse>(Endpoints.aiChat, body);
  },

  /**
   * 流式 chat：返回一个 AsyncIterable<StreamEvent>。
   * 调用方负责 AbortSignal 取消。
   */
  async *streamChat(body: ChatRequestBody, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const res = await postSse(Endpoints.aiChatStream, body, signal ? { signal } : {});
    for await (const ev of readSse(res, signal)) {
      yield ev;
      if (ev.type === "done" || ev.type === "error") return;
    }
  },
};