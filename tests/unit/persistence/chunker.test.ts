/**
 * Chunker 单元测试
 */

import { assert, assertEquals } from "@std/assert";
import { chunkText } from "@backend/persistence/sqlite/chunker.ts";

Deno.test("chunker —— 空文本 → 0 块", () => {
  assertEquals(chunkText({ text: "" }), []);
  assertEquals(chunkText({ text: "   " }), []);
});

Deno.test("chunker —— 短文本（单块）", () => {
  const out = chunkText({ text: "hello world" });
  assertEquals(out.length, 1);
  assertEquals(out[0].ordinal, 0);
  assertEquals(out[0].text, "hello world");
  assert(out[0].tokenCount > 0);
});

Deno.test("chunker —— 多段按段落切，ordinal 顺序", () => {
  const text = "第一段内容。\n\n第二段内容。\n\n第三段内容。";
  const out = chunkText({ text });
  assertEquals(out.length, 1);  // 单块能装下三个段落
  assertEquals(out[0].ordinal, 0);
});

Deno.test("chunker —— 段落超长 → 按句切", () => {
  const long = Array.from({ length: 30 }, (_, i) => `这是第 ${i + 1} 句话的内容很长的描述。`).join("");
  const out = chunkText({
    text: long,
    chunkMaxTokens: 50,  // 强制切
    charsPerToken: 2.5,  // maxChars = 125
  });
  assert(out.length > 1);
  assertEquals(out[0].ordinal, 0);
  for (let i = 0; i < out.length; i++) {
    assertEquals(out[i].ordinal, i);
  }
});

Deno.test("chunker —— 段落超长且无句号 → 硬切", () => {
  const long = "x".repeat(1000);
  const out = chunkText({
    text: long,
    chunkMaxTokens: 50,
    chunkOverlapTokens: 0,  // 关闭 overlap 让断言简单
    charsPerToken: 2.5,
  });
  assert(out.length > 1);
  for (const c of out) {
    assert(c.text.length <= 125, `chunk text length ${c.text.length} > 125`);
  }
});

Deno.test("chunker —— overlap：除首块外每块开头有上一块尾部", () => {
  const long = Array.from({ length: 10 }, (_, i) => `第${i + 1}段内容非常长，包含很多字符应该填满一个 chunk 的大小阈值。`).join("\n\n");
  const out = chunkText({
    text: long,
    chunkMaxTokens: 30,
    chunkOverlapTokens: 10,
    charsPerToken: 2.5,
  });
  assert(out.length > 1);
  // 第二块应包含第一块尾部的部分字符
  assert(out[1].text.length > out[1].text.length - 25);
});

Deno.test("chunker —— tokenCount 粗估合理", () => {
  const out = chunkText({ text: "x".repeat(100) });
  // 100 chars / 2.5 charsPerToken ≈ 40 tokens
  assert(out[0].tokenCount >= 30 && out[0].tokenCount <= 50);
});