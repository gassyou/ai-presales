/**
 * 任务 8：slash 命令 + 附件 + skill —— 测试
 *
 * 验证：
 *   - parseSlashCommand 支持 /help /skill /attach
 *   - passthrough 透传普通文本
 *   - 非法命令（/skill 缺名字）走 passthrough
 *   - slashToMessageInjection 生成正确的 role+content
 *   - /attach 返回的 attachments 包含 addedAt ISO
 */

import { assert, assertEquals } from "@std/assert";
import {
  parseSlashCommand,
  slashToMessageInjection,
  type ChatMessageAttachment,
} from "@backend/ai/chat/slash-command.ts";

function now(): Date {
  return new Date("2026-03-15T10:00:00Z");
}

// ====== parseSlashCommand ======

Deno.test("t8 — 纯文本（不带 /）→ passthrough", () => {
  const r = parseSlashCommand("你好，请介绍一下 ERP", now);
  assertEquals(r.command.type, "passthrough");
  assertEquals(r.command.arg, "你好，请介绍一下 ERP");
  assertEquals(r.command.passthrough, "你好，请介绍一下 ERP");
  assertEquals(r.attachments.length, 0);
});

Deno.test("t8 — /help → help 类型", () => {
  const r = parseSlashCommand("/help", now);
  assertEquals(r.command.type, "help");
  assertEquals(r.command.passthrough, null);
});

Deno.test("t8 — /skill <name> → skill 类型", () => {
  // 注意：/skill 与 name 之间必须有空格。整个 /skillXxx 形式是未知命令。
  const r = parseSlashCommand("/skill skill_list_skills", now);
  assertEquals(r.command.type, "skill");
  assertEquals(r.command.arg, "skill_list_skills");
});

Deno.test("t8 — /skill <name> <extra> → skill 类型 + extra", () => {
  const r = parseSlashCommand("/skill skill_echo hello world", now);
  assertEquals(r.command.type, "skill");
  assertEquals(r.command.arg, "skill_echo");
  assertEquals(r.command.extra, "hello world");
});

Deno.test("t8 — /skill 缺名字 → passthrough 兜底", () => {
  const r = parseSlashCommand("/skill", now);
  assertEquals(r.command.type, "passthrough");
  assertEquals(r.command.passthrough, "/skill");
});

Deno.test("t8 — /attach <url> → attach 类型 + 1 attachment", () => {
  const r = parseSlashCommand("/attach https://example.com/x.pdf", now);
  assertEquals(r.command.type, "attach");
  assertEquals(r.command.arg, "https://example.com/x.pdf");
  assertEquals(r.attachments.length, 1);
  const att = r.attachments[0] as ChatMessageAttachment;
  assertEquals(att.url, "https://example.com/x.pdf");
  assertEquals(att.addedAt, "2026-03-15T10:00:00.000Z");
});

Deno.test("t8 — /attach 缺 url → passthrough 兜底", () => {
  const r = parseSlashCommand("/attach", now);
  assertEquals(r.command.type, "passthrough");
});

Deno.test("t8 — 未知命令 /foo → passthrough", () => {
  const r = parseSlashCommand("/foo bar", now);
  assertEquals(r.command.type, "passthrough");
  assertEquals(r.command.arg, "/foo bar");
});

Deno.test("t8 — 空字符串 → passthrough", () => {
  const r = parseSlashCommand("", now);
  assertEquals(r.command.type, "passthrough");
  assertEquals(r.command.arg, "");
});

Deno.test("t8 — 前后空格被 trim", () => {
  const r = parseSlashCommand("   /help   ", now);
  assertEquals(r.command.type, "help");
});

// ====== slashToMessageInjection ======

Deno.test("t8 — passthrough → user 消息", () => {
  const m = slashToMessageInjection({
    type: "passthrough",
    arg: "hello",
    passthrough: "hello",
  });
  assert(m);
  assertEquals(m.role, "user");
  assertEquals(m.content, "hello");
});

Deno.test("t8 — /help → system 帮助文本", () => {
  const m = slashToMessageInjection({
    type: "help",
    arg: "",
    passthrough: null,
  });
  assert(m);
  assertEquals(m.role, "system");
  assert(m.content.includes("/help"));
});

Deno.test("t8 — /skill → system 注入文本", () => {
  const m = slashToMessageInjection({
    type: "skill",
    arg: "skill_echo",
    extra: "hi",
    passthrough: null,
  });
  assert(m);
  assertEquals(m.role, "system");
  assertEquals(m.content.includes("/skill skill_echo"), true);
  assertEquals(m.content.includes("hi"), true);
});

Deno.test("t8 — /attach → system 注入 URL", () => {
  const m = slashToMessageInjection({
    type: "attach",
    arg: "https://x",
    passthrough: null,
  });
  assert(m);
  assertEquals(m.role, "system");
  assertEquals(m.content.includes("https://x"), true);
});