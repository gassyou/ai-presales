/**
 * collectStreamToString 单元测试
 */
import { assertEquals, assertRejects } from "@std/assert";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { ToolCallId } from "@shared/types/ids.ts";

function asyncIterFromArray<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next(): Promise<IteratorResult<T>> {
          if (i < items.length) {
            return Promise.resolve({ value: items[i++]!, done: false });
          }
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
      };
    },
  };
}

Deno.test("collectStreamToString - concatenates chunk deltas", async () => {
  const stream = asyncIterFromArray<StreamEvent>([
    { type: "chunk", delta: "hello ", messageId: "m1" },
    { type: "chunk", delta: "world", messageId: "m1" },
    { type: "done", messageId: "m1", usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2 } },
  ]);
  const result = await collectStreamToString(stream);
  assertEquals(result, "hello world");
});

Deno.test("collectStreamToString - skips tool events", async () => {
  const stream = asyncIterFromArray<StreamEvent>([
    { type: "chunk", delta: "before ", messageId: "m1" },
    { type: "tool_call", toolCallId: ToolCallId("t1"), name: "search_knowledge", args: {} },
    { type: "tool_result", toolCallId: ToolCallId("t1"), ok: true, result: { hits: [] }, durationMs: 5 },
    { type: "chunk", delta: "after", messageId: "m1" },
    { type: "done", messageId: "m1", usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2 } },
  ]);
  const result = await collectStreamToString(stream);
  assertEquals(result, "before after");
});

Deno.test("collectStreamToString - returns empty string when no chunks", async () => {
  const stream = asyncIterFromArray<StreamEvent>([
    { type: "done", messageId: "m1", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
  ]);
  const result = await collectStreamToString(stream);
  assertEquals(result, "");
});

Deno.test("collectStreamToString - throws on terminal error", async () => {
  const stream = asyncIterFromArray<StreamEvent>([
    { type: "chunk", delta: "first ", messageId: "m1" },
    { type: "error", code: "LLM_INTERNAL", message: "boom", retryable: false },
  ]);
  await assertRejects(
    () => collectStreamToString(stream),
    Error,
    "LLM_INTERNAL",
  );
});

Deno.test("collectStreamToString - aborts on signal", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const stream = asyncIterFromArray<StreamEvent>([
    { type: "chunk", delta: "never", messageId: "m1" },
  ]);
  await assertRejects(
    () => collectStreamToString(stream, ctrl.signal),
    DOMException,
    "aborted",
  );
});