/**
 * CharacterBasedTokenCounter 单元测试
 */

import { assertEquals } from "@std/assert";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";

const tc = new CharacterBasedTokenCounter();

Deno.test("TokenCounter —— 空字符串返回 0", () => {
  assertEquals(tc.count(""), 0);
});

Deno.test("TokenCounter —— ASCII 短字符串", () => {
  // "hello" = 5 字符 → ceil(5/4) = 2
  assertEquals(tc.count("hello"), 2);
});

Deno.test("TokenCounter —— ASCII 长字符串", () => {
  // "x".repeat(120) → ceil(120/4) = 30
  assertEquals(tc.count("x".repeat(120)), 30);
});

Deno.test("TokenCounter —— CJK 中文", () => {
  // "你好世界" = 4 CJK 字符 → ceil(4/1.5) = 3
  assertEquals(tc.count("你好世界"), 3);
});

Deno.test("TokenCounter —— 两个 CJK 字符", () => {
  // "你好" = 2 CJK → ceil(2/1.5) = 2
  assertEquals(tc.count("你好"), 2);
});

Deno.test("TokenCounter —— 混合 CJK + ASCII", () => {
  // "你好hi" = 2 CJK + 2 ASCII → ceil(2/1.5) + ceil(2/4) = 2 + 1 = 3
  assertEquals(tc.count("你好hi"), 3);
});

Deno.test("TokenCounter.countMessages —— 加 role+分隔开销", () => {
  const total = tc.countMessages([
    { content: "hi" },        // 1 token + 2 separator
    { content: "你好" },      // 2 tokens + 2 separator
  ]);
  // 1 + 2 + 2 + 2 = 7
  assertEquals(total, 7);
});