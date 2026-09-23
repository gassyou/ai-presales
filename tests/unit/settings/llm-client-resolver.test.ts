/**
 * LLMClientResolver 单元测试 —— 阶段 7.4h（阶段 7.7 升级到 async）
 *
 * 覆盖：
 *   - 同一 profile 第二次 get 拿同一实例（缓存命中）
 *   - invalidate(name) 后下一次 get 重建
 *   - invalidate()（无参）清空所有
 *   - build 抛错会原样抛出
 *   - 并发同一 profile：in-flight promise 复用
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { LLMClientResolver } from "@backend/application/settings/llm-client-resolver.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";

function makeFakeClient(name: string): ILLMClient {
  return {
    provider: "anthropic",
    model: name,
    async chat() {
      return {
        message: {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "ok" }],
          model: name,
          stopReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      };
    },
  };
}

Deno.test("LLMClientResolver — cache 命中：同 profile 第二次拿同一实例", async () => {
  const built: string[] = [];
  const r = new LLMClientResolver(async (name) => {
    built.push(name);
    return makeFakeClient(name);
  });
  const a = await r.get("fast");
  const b = await r.get("fast");
  assert(a === b);
  assertEquals(built, ["fast"]);
  assertEquals(r.size(), 1);
});

Deno.test("LLMClientResolver — invalidate(name) 后下一次 get 重建", async () => {
  const r = new LLMClientResolver(async (name) => makeFakeClient(name));
  const a = await r.get("fast");
  r.invalidate("fast");
  const b = await r.get("fast");
  assert(a !== b);
  assertEquals(r.size(), 1);
});

Deno.test("LLMClientResolver — invalidate() 无参清空所有", async () => {
  const r = new LLMClientResolver(async (name) => makeFakeClient(name));
  await r.get("fast");
  await r.get("deep");
  assertEquals(r.size(), 2);
  r.invalidate();
  assertEquals(r.size(), 0);
});

Deno.test("LLMClientResolver — build 抛错会原样抛出", async () => {
  const r = new LLMClientResolver(async () => {
    throw new Error("profile not found");
  });
  await assertRejects(
    () => r.get("unknown"),
    Error,
    "profile not found",
  );
});

Deno.test("LLMClientResolver — 并发同 profile：in-flight promise 复用，不重复 build", async () => {
  const built: string[] = [];
  const r = new LLMClientResolver(async (name) => {
    built.push(name);
    await new Promise((r) => setTimeout(r, 5));
    return makeFakeClient(name);
  });
  const [a, b, c] = await Promise.all([
    r.get("fast"),
    r.get("fast"),
    r.get("fast"),
  ]);
  assert(a === b);
  assert(b === c);
  assertEquals(built, ["fast"]);
});