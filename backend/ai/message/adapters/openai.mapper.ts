/**
 * OpenAI ↔ Canonical mapper
 *
 * OpenAI Chat Completions API：
 *   - system/user/assistant/tool 四 role
 *   - tool result 用 role:"tool" + tool_call_id
 *   - 工具用 tools:[{type:"function", function:{name, description, parameters}}]
 */

import type {
  CanonicalAssistantMessage,
  CanonicalContentPart,
  CanonicalMessage,
  ChatUsage,
  ToolSpec,
} from "../canonical-message.ts";
import type { ToolCallId } from "@shared/types/ids.ts";

interface OpenAITextPart {
  type: "text";
  text: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIAssistantContent {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | OpenAIAssistantContent
  | OpenAIToolMessage;

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OpenAIRequest {
  model: string;
  temperature?: number;
  max_tokens?: number;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream?: boolean;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIChoice {
  index: number;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

// ---------- canonical → OpenAI ----------

export function canonicalToOpenAIRequest(req: {
  systemPrompt?: string;
  messages: readonly CanonicalMessage[];
  model: string;
  temperature: number;
  maxOutputTokens: number;
  tools?: readonly ToolSpec[];
}): OpenAIRequest {
  const messages: OpenAIMessage[] = [];
  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt });
  }

  for (const m of req.messages) {
    if (m.role === "system") {
      // 合并到顶层 system；为简化只保留第一条
      const text = m.content.map((p) => p.type === "text" ? p.text : "").join("");
      messages.push({ role: "system", content: text });
      continue;
    }
    if (m.role === "user") {
      const text = m.content.map((p) => p.type === "text" ? p.text : "").join("");
      messages.push({ role: "user", content: text });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content
        .filter((p): p is Extract<CanonicalContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text).join("");
      const toolCalls: OpenAIToolCall[] = m.content
        .filter((p): p is Extract<CanonicalContentPart, { type: "tool_use" }> => p.type === "tool_use")
        .map((p) => ({
          id: p.toolCallId,
          type: "function",
          function: { name: p.name, arguments: JSON.stringify(p.args ?? {}) },
        }));
      messages.push({
        role: "assistant",
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type === "tool_result") {
          messages.push({
            role: "tool",
            tool_call_id: p.toolCallId,
            content: p.content,
          });
        }
      }
    }
  }

  const out: OpenAIRequest = {
    model: req.model,
    temperature: req.temperature,
    max_tokens: req.maxOutputTokens,
    messages,
  };
  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }
  return out;
}

// ---------- OpenAI → canonical ----------

export function openAIToCanonicalMessage(res: OpenAIResponse): CanonicalAssistantMessage {
  const choice = res.choices[0];
  const parts: CanonicalContentPart[] = [];
  if (!choice) {
    return {
      role: "assistant",
      content: [],
      stopReason: "unknown",
      usage: openaiUsage(res.usage),
      model: res.model,
    };
  }
  if (choice.message.content) {
    parts.push({ type: "text", text: choice.message.content });
  }
  for (const tc of choice.message.tool_calls ?? []) {
    let args: unknown = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      args = { _raw: tc.function.arguments };
    }
    parts.push({
      type: "tool_use",
      toolCallId: tc.id as ToolCallId,
      name: tc.function.name,
      args,
    });
  }

  let stopReason: CanonicalAssistantMessage["stopReason"] = "unknown";
  switch (choice.finish_reason) {
    case "stop":
      stopReason = "end_turn"; break;
    case "length":
      stopReason = "max_tokens"; break;
    case "tool_calls":
      stopReason = "tool_use"; break;
  }

  return {
    role: "assistant",
    content: parts,
    stopReason,
    usage: openaiUsage(res.usage),
    model: res.model,
  };
}

function openaiUsage(u: OpenAIUsage): ChatUsage {
  return {
    inputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  };
}

export type { OpenAIRequest, OpenAIResponse };