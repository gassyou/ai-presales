/**
 * mention-parser 单元测试（Deno 运行；纯函数）
 *
 * 后端权威，前端做高亮 + autocomplete 时也走同一份正则。
 */

import { assert, assertEquals } from "@std/assert";
import {
  extractMentionTokens,
  splitByMentions,
  renderMentionsAsHtml,
  MENTION_PATTERN,
} from "@frontend/shared/utils/mention-parser.ts";

Deno.test("mention —— MENTION_PATTERN 匹配中英文 + hyphen + 下划线", () => {
  const cases: Array<[string, string[]]> = [
    ["@A-2025-001", ["A-2025-001"]],
    ["@项目A", ["项目A"]],
    ["@项目_A", ["项目_A"]],
    ["@client", ["client"]],
  ];
  for (const [input, expected] of cases) {
    const got = [...input.matchAll(MENTION_PATTERN)].map((m) => m[1]);
    assertEquals(got, expected, `failed for ${input}`);
  }
});

Deno.test("mention —— '.' 不在白名单里 → @client.name 只取 client", () => {
  const got = [..."@client.name".matchAll(MENTION_PATTERN)].map((m) => m[1]);
  assertEquals(got, ["client"]);
});

Deno.test("mention —— email 里 @ 后字符仍是合法 token；后端按项目列表模糊匹配", () => {
  // foo@bar.com → "bar" 是合法 token（白名单字符），但后端按项目列表查 "bar" 找不到 → 降级为字面
  // 这里只验证解析层把"@"后面直到白名单结束的部分当 token
  const text = "邮箱 foo@bar.com 请忽略";
  const tokens = [...text.matchAll(MENTION_PATTERN)].map((m) => m[1]);
  assertEquals(tokens, ["bar"]);
});

Deno.test("extractMentionTokens —— 去重 + 保序", () => {
  const tokens = extractMentionTokens("请参考 @A 和 @B 也看看 @A");
  assertEquals(tokens, ["A", "B"]);
});

Deno.test("extractMentionTokens —— 大小写不敏感去重", () => {
  const tokens = extractMentionTokens("@A-2025-001 @a-2025-001");
  assertEquals(tokens.length, 1);
});

Deno.test("extractMentionTokens —— 空文本", () => {
  assertEquals(extractMentionTokens(""), []);
  assertEquals(extractMentionTokens("hello world"), []);
});

Deno.test("splitByMentions —— 切分顺序正确", () => {
  const segs = splitByMentions("你好 @A ，看 @B");
  assertEquals(segs.length, 4);
  assertEquals(segs[0], { kind: "text", text: "你好 " });
  assertEquals(segs[1], { kind: "mention", token: "A" });
  assertEquals(segs[2], { kind: "text", text: " ，看 " });
  assertEquals(segs[3], { kind: "mention", token: "B" });
});

Deno.test("splitByMentions —— 全文本无 mention", () => {
  const segs = splitByMentions("hello world");
  assertEquals(segs.length, 1);
  assertEquals(segs[0], { kind: "text", text: "hello world" });
});

Deno.test("splitByMentions —— 首尾 mention", () => {
  const segs = splitByMentions("@A hi @B");
  assertEquals(segs.length, 3);
  assertEquals(segs[0], { kind: "mention", token: "A" });
  assertEquals(segs[1], { kind: "text", text: " hi " });
  assertEquals(segs[2], { kind: "mention", token: "B" });
});

Deno.test("renderMentionsAsHtml —— XSS 安全：& < > 被 escape", () => {
  // 由于字符白名单限制，token 里不会有这些字符，但前后文可能有
  const html = renderMentionsAsHtml("a <script> @A &");
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes("&amp;"));
  assert(html.includes('<span class="mention" data-mention="A">@A</span>'));
});

Deno.test("renderMentionsAsHtml —— 自定义 className", () => {
  const html = renderMentionsAsHtml("@A", { className: "my-mention" });
  assert(html.includes('class="my-mention"'));
});

Deno.test("renderMentionsAsHtml —— attribute escape", () => {
  // token 里没有双引号（白名单限制），但要确保 attribute 闭合正确
  const html = renderMentionsAsHtml("@hello");
  assert(html.includes('data-mention="hello"'));
});