/**
 * Anthropic mapper 单元测试
 */

import { assert, assertEquals } from "@std/assert";
import {
  anthropicToCanonicalMessage,
  canonicalToAnthropicRequest,
  type AnthropicResponse,
} from "@backend/ai/message/adapters/anthropic.mapper.ts";
import type { CanonicalMessage } from "@backend/ai/message/canonical-message.ts";
import { ToolCallId } from "@shared/types/ids.ts";

Deno.test("canonicalToAnthropicRequest —— 把 system 提到顶层，把 tool result 合并到 user role", () => {
  const messages: CanonicalMessage[] = [
    { role: "system", content: [{ type: "text", text: "你是助手" }] },
    { role: "user", content: [{ type: "text", text: "你好" }] },
    { role: "assistant", content: [
      { type: "text", text: "我来读文件" },
      { type: "tool_use", toolCallId: ToolCallId("call_1"), name: "read_file", args: { path: "a.txt" } },
    ] },
    { role: "tool", content: [
      { type: "tool_result", toolCallId: ToolCallId("call_1"), content: "hello", isError: false },
    ] },
  ];
  const req = canonicalToAnthropicRequest({
    systemPrompt: "你是助手",
    messages,
    model: "claude-haiku-4-5",
    temperature: 0.2,
    maxOutputTokens: 4096,
  });
  assertEquals(req.model, "claude-haiku-4-5");
  assertEquals(req.system, "你是助手");
  assertEquals(req.messages.length, 3);    // user + assistant + user(tool_result)
  const last = req.messages[2];
  assertEquals(last.role, "user");
  const arr = last.content as Array<{ type: string; tool_use_id?: string; is_error?: boolean }>;
  assertEquals(arr[0].type, "tool_result");
  assertEquals(arr[0].tool_use_id, "call_1");
  assertEquals(arr[0].is_error, undefined);
});

Deno.test("canonicalToAnthropicRequest —— tool_result isError=true 写入 is_error=true", () => {
  const messages: CanonicalMessage[] = [
    { role: "tool", content: [
      { type: "tool_result", toolCallId: ToolCallId("c1"), content: "boom", isError: true },
    ] },
  ];
  const req = canonicalToAnthropicRequest({
    messages,
    model: "claude-x", temperature: 0, maxOutputTokens: 1024,
  });
  const arr = req.messages[0].content as Array<{ type: string; is_error?: boolean }>;
  assertEquals(arr[0].is_error, true);
});

Deno.test("anthropicToCanonicalMessage —— end_turn 文本回复", () => {
  const res: AnthropicResponse = {
    id: "msg_1",
    model: "claude-haiku-4-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "你好" }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  const m = anthropicToCanonicalMessage(res);
  assertEquals(m.role, "assistant");
  assertEquals(m.stopReason, "end_turn");
  assertEquals(m.usage.inputTokens, 10);
  assertEquals(m.usage.outputTokens, 5);
  assertEquals(m.usage.totalTokens, 15);
  const part = m.content[0];
  assertEquals(part.type, "text");
  assertEquals(part.type === "text" ? part.text : "", "你好");
});

Deno.test("anthropicToCanonicalMessage —— tool_use stop_reason=tool_use", () => {
  const res: AnthropicResponse = {
    id: "msg_2",
    model: "claude-x",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t_1", name: "read_file", input: { path: "a" } }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const m = anthropicToCanonicalMessage(res);
  assertEquals(m.stopReason, "tool_use");
  const part = m.content[0];
  assertEquals(part.type, "tool_use");
  if (part.type === "tool_use") {
    assertEquals(part.name, "read_file");
    assertEquals(part.args, { path: "a" });
  }
});

Deno.test("anthropicToCanonicalMessage —— max_tokens 透传", () => {
  const res: AnthropicResponse = {
    id: "x", model: "x", stop_reason: "max_tokens", content: [], usage: { input_tokens: 0, output_tokens: 0 },
  };
  const m = anthropicToCanonicalMessage(res);
  assertEquals(m.stopReason, "max_tokens");
  assert(m.content.length === 0, "empty content");
});