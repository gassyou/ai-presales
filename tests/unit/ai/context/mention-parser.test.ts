/**
 * MentionParser 单元测试
 */

import { assertEquals } from "@std/assert";
import {
  extractMentionTokens,
  renderMentionsAsHtml,
  splitByMentions,
} from "@backend/ai/context/mention-parser.ts";

Deno.test("extractMentionTokens —— 单 mention", () => {
  assertEquals(extractMentionTokens("@A-2025-001"), ["A-2025-001"]);
});

Deno.test("extractMentionTokens —— 多 mention", () => {
  assertEquals(
    extractMentionTokens("请参考 @A-2025-001 和 @B 项目"),
    ["A-2025-001", "B"],
  );
});

Deno.test("extractMentionTokens —— 无 mention", () => {
  assertEquals(extractMentionTokens("hello world"), []);
});

Deno.test("extractMentionTokens —— 含 CJK 字符的 mention", () => {
  assertEquals(extractMentionTokens("@项目一"), ["项目一"]);
});

Deno.test("extractMentionTokens —— 多次调用结果一致（lastIndex 重置）", () => {
  assertEquals(extractMentionTokens("@A-2025-001"), ["A-2025-001"]);
  assertEquals(extractMentionTokens("@B 项目"), ["B"]);
  assertEquals(extractMentionTokens("@A-2025-001"), ["A-2025-001"]);
});

Deno.test("splitByMentions —— 分段正确", () => {
  const segs = splitByMentions("请参考 @A 项目 和 @B");
  assertEquals(segs.length, 4);
  assertEquals(segs[0], { kind: "literal", text: "请参考 " });
  assertEquals(segs[1], { kind: "mention", token: "A" });
  assertEquals(segs[2], { kind: "literal", text: " 项目 和 " });
  assertEquals(segs[3], { kind: "mention", token: "B" });
});

Deno.test("splitByMentions —— 纯 mention", () => {
  const segs = splitByMentions("@only");
  assertEquals(segs.length, 1);
  assertEquals(segs[0], { kind: "mention", token: "only" });
});

Deno.test("renderMentionsAsHtml —— 转义 XSS", () => {
  const html = renderMentionsAsHtml("@<script>");
  assertEquals(html.includes("&lt;script&gt;"), true);
  assertEquals(html.includes("<script>"), false);
});

Deno.test("renderMentionsAsHtml —— unresolved mention 有提示 title", () => {
  const html = renderMentionsAsHtml("@missing");
  assertEquals(html.includes("unresolved mention"), true);
});

Deno.test("renderMentionsAsHtml —— resolved 加 project id", () => {
  const resolved = new Map([["A", "p-uuid"]]);
  const html = renderMentionsAsHtml("@A", resolved);
  assertEquals(html.includes("project: p-uuid"), true);
});