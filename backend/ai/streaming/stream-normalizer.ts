/**
 * StreamNormalizer —— 把 provider 流式 chunk 归一为 StreamEvent
 *
 * 每个 provider 都有自己的事件类型 + 字段命名：
 *   Anthropic:   message_start → content_block_start → content_block_delta* → content_block_stop → message_delta → message_stop
 *   OpenAI:      {choices:[{delta:{content?, tool_calls?}}]}
 *
 * 这里提供两个 normalizer：
 *   - normalizeAnthropicStream(rawEvents): StreamEvent
 *   - normalizeOpenAIStream(rawEvents): StreamEvent
 *
 * 调用方（adapter）只需把 provider 的 chunk 序列扔进来。
 */

import type { StreamEvent } from "../message/canonical-message.ts";
import type { ToolCallId } from "@shared/types/ids.ts";

interface AnthropicStreamEvent {
  type:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop"
    | "ping"
    | "error";
  message?: {
    id: string;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  index?: number;
  content_block?: {
    type: "text" | "tool_use";
    text?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type?: "text_delta" | "input_json_delta";
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  error?: { type: string; message: string };
}

export interface NormalizerState {
  textBuffer: string;
  toolCalls: Map<number, { id: string; name: string; argsJson: string }>;
  usage: { input: number; output: number };
  model: string;
  done: boolean;
}

export function newNormalizerState(): NormalizerState {
  return {
    textBuffer: "",
    toolCalls: new Map(),
    usage: { input: 0, output: 0 },
    model: "",
    done: false,
  };
}

/** 喂一个 chunk，返回该产生的 StreamEvent（可能 0..n 个） */
export function normalizeAnthropicChunk(
  state: NormalizerState,
  raw: unknown,
): StreamEvent[] {
  const ev = raw as AnthropicStreamEvent;
  const out: StreamEvent[] = [];

  if (ev.type === "message_start") {
    if (ev.message) {
      state.model = ev.message.model;
      state.usage.input = ev.message.usage.input_tokens;
      state.usage.output = ev.message.usage.output_tokens;
    }
    return out;
  }
  if (ev.type === "content_block_start") {
    if (ev.content_block?.type === "tool_use" && ev.index !== undefined) {
      state.toolCalls.set(ev.index, {
        id: ev.content_block.id ?? "",
        name: ev.content_block.name ?? "",
        argsJson: "",
      });
    }
    return out;
  }
  if (ev.type === "content_block_delta") {
    const idx = ev.index ?? -1;
    if (ev.delta?.type === "text_delta" && ev.delta.text) {
      state.textBuffer += ev.delta.text;
      out.push({ type: "chunk", delta: ev.delta.text, messageId: state.model });
    } else if (ev.delta?.type === "input_json_delta" && idx >= 0) {
      const tc = state.toolCalls.get(idx);
      if (tc && ev.delta.partial_json) {
        tc.argsJson += ev.delta.partial_json;
      }
    }
    return out;
  }
  if (ev.type === "message_delta") {
    if (ev.delta?.stop_reason === "max_tokens") {
      state.done = true;
    }
    return out;
  }
  if (ev.type === "message_stop") {
    state.done = true;
    // 把累积的 tool_calls 一次吐完
    for (const tc of state.toolCalls.values()) {
      let args: unknown = {};
      if (tc.argsJson.length > 0) {
        try {
          args = JSON.parse(tc.argsJson);
        } catch {
          args = { _raw: tc.argsJson };
        }
      }
      out.push({
        type: "tool_call",
        toolCallId: tc.id as ToolCallId,
        name: tc.name,
        args,
      });
    }
    out.push({
      type: "done",
      messageId: state.model,
      usage: {
        inputTokens: state.usage.input,
        outputTokens: state.usage.output,
        totalTokens: state.usage.input + state.usage.output,
      },
    });
    return out;
  }
  if (ev.type === "error" && ev.error) {
    out.push({
      type: "error",
      code: ev.error.type || "LLM_UPSTREAM_ERROR",
      message: ev.error.message,
      retryable: true,
    });
    return out;
  }
  return out;
}

// ---------- OpenAI ----------

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function normalizeOpenAIChunk(
  state: NormalizerState,
  raw: unknown,
): StreamEvent[] {
  const ev = raw as OpenAIStreamChunk;
  const out: StreamEvent[] = [];
  state.model = ev.model;

  for (const choice of ev.choices ?? []) {
    if (choice.delta.content) {
      state.textBuffer += choice.delta.content;
      out.push({ type: "chunk", delta: choice.delta.content, messageId: ev.id });
    }
    for (const tc of choice.delta.tool_calls ?? []) {
      const cur = state.toolCalls.get(tc.index) ?? { id: "", name: "", argsJson: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.argsJson += tc.function.arguments;
      state.toolCalls.set(tc.index, cur);
    }
  }
  if (ev.usage) {
    state.usage.input = ev.usage.prompt_tokens;
    state.usage.output = ev.usage.completion_tokens;
  }
  const finished = ev.choices?.some((c) => c.finish_reason !== null && c.finish_reason !== undefined);
  if (finished) {
    for (const tc of state.toolCalls.values()) {
      let args: unknown = {};
      if (tc.argsJson.length > 0) {
        try {
          args = JSON.parse(tc.argsJson);
        } catch {
          args = { _raw: tc.argsJson };
        }
      }
      out.push({
        type: "tool_call",
        toolCallId: tc.id as ToolCallId,
        name: tc.name,
        args,
      });
    }
    out.push({
      type: "done",
      messageId: ev.id,
      usage: {
        inputTokens: state.usage.input,
        outputTokens: state.usage.output,
        totalTokens: state.usage.input + state.usage.output,
      },
    });
    state.done = true;
  }
  return out;
}