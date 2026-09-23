/**
 * ContextBudget 单元测试
 */

import { assert, assertEquals } from "@std/assert";
import { calculateBudget, truncateToTokens } from "@backend/ai/context/context-budget.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";

Deno.test("calculateBudget —— total = contextWindow - maxOutputTokens", () => {
  const b = calculateBudget({ contextWindow: 200_000, maxOutputTokens: 8_192 });
  assertEquals(b.total, 191_808);
});

Deno.test("calculateBudget —— 各段按比例分配，合计 ≈ total", () => {
  const b = calculateBudget({ contextWindow: 100_000, maxOutputTokens: 10_000 });
  const sum = b.systemPrompt + b.projectContext + b.ragHits + b.businessModules +
    b.conversationHistory + b.userInput;
  // 6 段每段 Math.floor，sum 可能略小于 total，差额 <= 6
  assert(sum >= b.total - 6, `sum=${sum}, total=${b.total}`);
  assert(sum <= b.total, `sum=${sum} should not exceed total=${b.total}`);
});

Deno.test("calculateBudget —— maxOutputTokens >= contextWindow 时 total = 0", () => {
  const b = calculateBudget({ contextWindow: 1000, maxOutputTokens: 2000 });
  assertEquals(b.total, 0);
  assertEquals(b.systemPrompt, 0);
});

Deno.test("calculateBudget —— 各段比例正确（200K contextWindow）", () => {
  const b = calculateBudget({ contextWindow: 200_000, maxOutputTokens: 8_000 });
  // total = 192000
  // systemPrompt = 192000 * 0.08 = 15360
  assertEquals(b.systemPrompt, Math.floor(192000 * 0.08));
  assertEquals(b.ragHits, Math.floor(192000 * 0.20));
  assertEquals(b.businessModules, Math.floor(192000 * 0.30));
  assertEquals(b.userInput, Math.max(1, Math.floor(192000 * 0.05)));
});

Deno.test("truncateToTokens —— 字符串本身就在预算内 → 原样返回", () => {
  const tc = new CharacterBasedTokenCounter();
  assertEquals(truncateToTokens("hi", 100, tc), "hi");
});

Deno.test("truncateToTokens —— 超长 → 截到 ≤ maxTokens + 省略号", () => {
  const tc = new CharacterBasedTokenCounter();
  const long = "x".repeat(1000);
  const out = truncateToTokens(long, 5, tc);
  assert(tc.count(out) <= 5);
  assert(out.endsWith("…") || out.length <= 5);
});

Deno.test("truncateToTokens —— 中日文按 CJK 密度裁剪", () => {
  const tc = new CharacterBasedTokenCounter();
  // "你好世界" ~ 3 token
  // 100 个"你" ≈ 67 token
  const long = "你".repeat(100);
  const out = truncateToTokens(long, 10, tc);
  assert(tc.count(out) <= 10);
});