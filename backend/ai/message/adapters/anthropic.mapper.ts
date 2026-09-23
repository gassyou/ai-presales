/**
 * Anthropic ↔ Canonical mapper
 *
 * Anthropic 消息特征：
 *     system = 顶层 system 字段（数组）
 *     user   = { role: "user", content: string | [{type:"text",...},{type:"tool_result",...}] }
 *     assistant = { role: "assistant", content: [{type:"text"}, {type:"tool_use"}] }
 *
 * 转换要点：
 *   - tool_use  ↔ CanonicalToolUsePart
 *   - tool_result ↔ CanonicalToolResultPart
 *   - tool_call_id 一一对应
 */

import type {
  CanonicalAssistantMessage,
  CanonicalContentPart,
  CanonicalMessage,
  ChatUsage,
  ToolSpec,
} from "../canonical-message.ts";
import type { ToolCallId } from "@shared/types/ids.ts";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
  is_error?: boolean;
}
type AnthropicContent = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicTool[];
  messages: AnthropicMessage[];
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface AnthropicResponse {
  id: string;
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  content: AnthropicContent[];
  usage: AnthropicUsage;
}

// ---------- canonical → Anthropic ----------

export function canonicalToAnthropicRequest(req: {
  systemPrompt?: string;
  messages: readonly CanonicalMessage[];
  model: string;
  temperature: number;
  maxOutputTokens: number;
  tools?: readonly ToolSpec[];
}): AnthropicRequest {
  const messages: AnthropicMessage[] = [];
  for (const m of req.messages) {
    if (m.role === "system") continue;          // 走顶层 system
    if (m.role === "assistant") {
      const blocks: AnthropicContent[] = [];
      for (const p of m.content) {
        if (p.type === "text") blocks.push({ type: "text", text: p.text });
        else if (p.type === "tool_use") blocks.push({ type: "tool_use", id: p.toolCallId, name: p.name, input: p.args });
        // assistant 没有 tool_result，吞掉
      }
      messages.push({ role: "assistant", content: blocks });
    } else if (m.role === "user") {
      const blocks: AnthropicContent[] = [];
      for (const p of m.content) {
        if (p.type === "text") blocks.push({ type: "text", text: p.text });
      }
      messages.push({ role: "user", content: blocks });
    } else if (m.role === "tool") {
      const blocks: AnthropicContent[] = [];
      for (const p of m.content) {
        if (p.type === "tool_result") {
          blocks.push({
            type: "tool_result",
            tool_use_id: p.toolCallId,
            content: p.content,
            ...(p.isError ? { is_error: true } : {}),
          });
        }
      }
      // 工具结果必须发到 user role
      messages.push({ role: "user", content: blocks });
    }
  }

  const out: AnthropicRequest = {
    model: req.model,
    max_tokens: req.maxOutputTokens,
    temperature: req.temperature,
    messages,
  };
  if (req.systemPrompt && req.systemPrompt.length > 0) {
    out.system = req.systemPrompt;
  }
  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
  return out;
}

// ---------- Anthropic → canonical ----------

export function anthropicToCanonicalMessage(res: AnthropicResponse): CanonicalAssistantMessage {
  const parts: CanonicalContentPart[] = [];
  for (const block of res.content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      parts.push({
        type: "tool_use",
        toolCallId: block.id as ToolCallId,
        name: block.name,
        args: block.input,
      });
    }
  }

  let stopReason: CanonicalAssistantMessage["stopReason"] = "unknown";
  switch (res.stop_reason) {
    case "end_turn":
      stopReason = "end_turn"; break;
    case "tool_use":
      stopReason = "tool_use"; break;
    case "max_tokens":
      stopReason = "max_tokens"; break;
    case "stop_sequence":
      stopReason = "stop"; break;
  }

  const u: ChatUsage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    totalTokens: res.usage.input_tokens + res.usage.output_tokens,
  };

  return {
    role: "assistant",
    content: parts,
    stopReason,
    usage: u,
    model: res.model,
  };
}

// 导出供单元测试对照
export type { AnthropicRequest, AnthropicResponse };