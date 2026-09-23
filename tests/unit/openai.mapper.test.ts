/**
 * OpenAI mapper 单元测试
 */

import { assertEquals } from "@std/assert";
import {
  canonicalToOpenAIRequest,
  openAIToCanonicalMessage,
  type OpenAIResponse,
} from "@backend/ai/message/adapters/openai.mapper.ts";
import type { CanonicalMessage } from "@backend/ai/message/canonical-message.ts";
import { ToolCallId } from "@shared/types/ids.ts";

Deno.test("canonicalToOpenAIRequest —— 顶层 system + 普通 user 文本", () => {
  const messages: CanonicalMessage[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ];
  const req = canonicalToOpenAIRequest({
    systemPrompt: "sys",
    messages,
    model: "gpt-4o-mini", temperature: 0.3, maxOutputTokens: 512,
  });
  assertEquals(req.model, "gpt-4o-mini");
  assertEquals(req.messages.length, 2);
  assertEquals(req.messages[0].role, "system");
  assertEquals(req.messages[1].role, "user");
});

Deno.test("canonicalToOpenAIRequest —— assistant tool_calls + tool 消息互转", () => {
  const messages: CanonicalMessage[] = [
    { role: "user", content: [{ type: "text", text: "读 a.txt" }] },
    { role: "assistant", content: [
      { type: "tool_use", toolCallId: ToolCallId("c1"), name: "read_file", args: { p: "a" } },
    ] },
    { role: "tool", content: [
      { type: "tool_result", toolCallId: ToolCallId("c1"), content: "hello", isError: false },
    ] },
  ];
  const req = canonicalToOpenAIRequest({
    messages, model: "gpt-x", temperature: 0, maxOutputTokens: 100,
  });
  assertEquals(req.messages.length, 3);
  const asst = req.messages[1];
  if (asst.role === "assistant") {
    assertEquals(asst.content, null);
    assertEquals(asst.tool_calls?.length, 1);
    assertEquals(asst.tool_calls?.[0].id, "c1");
    assertEquals(JSON.parse(asst.tool_calls![0].function.arguments), { p: "a" });
  }
  const tool = req.messages[2];
  assertEquals(tool.role, "tool");
  if (tool.role === "tool") {
    assertEquals(tool.tool_call_id, "c1");
    assertEquals(tool.content, "hello");
  }
});

Deno.test("openAIToCanonicalMessage —— 文本响应", () => {
  const res: OpenAIResponse = {
    id: "x",
    model: "gpt-4o-mini",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  const m = openAIToCanonicalMessage(res);
  assertEquals(m.stopReason, "end_turn");
  assertEquals(m.usage.totalTokens, 2);
  assertEquals(m.content[0].type, "text");
});

Deno.test("openAIToCanonicalMessage —— tool_calls 解析 JSON args", () => {
  const res: OpenAIResponse = {
    id: "x", model: "gpt-x",
    choices: [{
      index: 0, finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: '{"a":1}' } }],
      },
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  const m = openAIToCanonicalMessage(res);
  assertEquals(m.stopReason, "tool_use");
  const part = m.content[0];
  assertEquals(part.type, "tool_use");
  if (part.type === "tool_use") {
    assertEquals(part.name, "f");
    assertEquals(part.args, { a: 1 });
  }
});

Deno.test("openAIToCanonicalMessage —— malformed args 兜底为 _raw", () => {
  const res: OpenAIResponse = {
    id: "x", model: "gpt-x",
    choices: [{
      index: 0, finish_reason: "tool_calls",
      message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "c2", type: "function", function: { name: "f", arguments: "not json" } }],
      },
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  const m = openAIToCanonicalMessage(res);
  const part = m.content[0];
  if (part.type === "tool_use") {
    assertEquals(part.args, { _raw: "not json" });
  }
});