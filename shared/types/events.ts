/**
 * SSE 流式事件枚举
 *
 * 后端向前端推送的事件类型。`type` 决定消费逻辑，`payload` 携带具体数据。
 */

export const StreamEventType = {
  CHUNK: "chunk", // 增量文本
  TOOL_CALL: "tool_call", // LLM 请求调用工具
  TOOL_RESULT: "tool_result", // 工具执行结果
  DONE: "done", // 流结束（带 usage）
  ERROR: "error", // 错误
} as const;

export type StreamEventTypeValue = (typeof StreamEventType)[keyof typeof StreamEventType];

export interface StreamChunkEvent {
  type: typeof StreamEventType.CHUNK;
  delta: string;
  messageId: string;
}

export interface StreamToolCallEvent {
  type: typeof StreamEventType.TOOL_CALL;
  toolCallId: string;
  name: string;
  args: unknown;
}

export interface StreamToolResultEvent {
  type: typeof StreamEventType.TOOL_RESULT;
  toolCallId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface StreamDoneEvent {
  type: typeof StreamEventType.DONE;
  messageId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface StreamErrorEvent {
  type: typeof StreamEventType.ERROR;
  code: string;
  message: string;
  retryable: boolean;
}

export type StreamEvent =
  | StreamChunkEvent
  | StreamToolCallEvent
  | StreamToolResultEvent
  | StreamDoneEvent
  | StreamErrorEvent;