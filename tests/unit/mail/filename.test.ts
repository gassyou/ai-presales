/**
 * filename.ts 单元测试
 *
 * 覆盖：普通 / 路径分隔符 / `..` / NUL / 超长 / 空
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { sanitizeFilename } from "@backend/application/mail/filename.ts";

Deno.test("sanitizeFilename - 普通文件名原样保留", () => {
  const out = sanitizeFilename("report.pdf");
  // 前缀 ts-rand-；原名紧跟其后
  assertEquals(out.endsWith("-report.pdf"), true);
});

Deno.test("sanitizeFilename - 含路径分隔符 → 替换为 _", () => {
  const out = sanitizeFilename("../etc/passwd.txt");
  // 路径分隔符与 `..` 都应被剥
  assertEquals(out.includes("/"), false);
  assertEquals(out.includes(".."), false);
  assertEquals(out.endsWith("passwd.txt"), true);
});

Deno.test("sanitizeFilename - 含 NUL 字节 → 截掉", () => {
  const out = sanitizeFilename("malicious\0file.txt");
  assertEquals(out.includes("\0"), false);
  // NUL 仅截掉，不强制插入分隔符
  assertEquals(out.endsWith("maliciousfile.txt"), true);
});

Deno.test("sanitizeFilename - 超长文件名截断且保留扩展名", () => {
  const long = "x".repeat(500) + ".verylongextension";
  const out = sanitizeFilename(long);
  // 总长应 ≤ PREFIX_TS_LEN + "-" + RAND + "-" + 200 = 19 + 200 = 219
  assertEquals(out.length <= 220, true);
  // 扩展名应保留（最大 20 字符以内）
  assertEquals(out.endsWith(".verylongextension"), true);
});

Deno.test("sanitizeFilename - 空 / 纯分隔符 → 抛错", () => {
  assertThrows(() => sanitizeFilename(""), Error, "empty filename");
  assertThrows(() => sanitizeFilename("../../.."), Error, "empty filename");
  assertThrows(() => sanitizeFilename("   "), Error, "empty filename");
});