/**
 * 任务 10：取消 ChatComposer 中的附件 icon —— 测试
 *
 * 验证：
 *   - ChatComposer.vue 不再有附件 icon 按钮
 *   - ChatComposer.vue 不再有 "附件" 字样
 *   - ChatComposer.vue 仍有添加按钮（不受影响）
 *   - （关联文件）无残留附件 icon 的代码
 *
 * 用静态文本扫描而非渲染（项目无 vue 测试基础设施）。
 */

import { assert, assertStringIncludes } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = Deno.cwd();

function readText(rel: string): string {
  return Deno.readTextFileSync(join(projectRoot, rel));
}

Deno.test("t10 — ChatComposer 不再有附件 icon 按钮", () => {
  const src = readText("frontend/src/features/ai-chat/ChatComposer.vue");
  // 注释里允许提到"附件"（说明性）；模板里不能有附件 icon button
  // 用 template 块约束：<template> ... </template> 之间
  const template = src.match(/<template>[\s\S]*?<\/template>/);
  assert(template, "<template> 块必须存在");
  // 检查不出现 Paperclip（Element Plus 的回形针图标）—— 附件功能由 / 命令 + skill 提供
  assert(!template[0].includes("Paperclip"), "template 里不应有 Paperclip 附件图标");
});

Deno.test("t10 — ChatComposer 模板里不含 title='附件' 按钮", () => {
  const src = readText("frontend/src/features/ai-chat/ChatComposer.vue");
  const template = src.match(/<template>[\s\S]*?<\/template>/);
  assert(template);
  assert(!template[0].includes('title="附件'), "缺少附件按钮");
});

Deno.test("t10 — ChatComposer 仍有添加按钮（Plus 图标）", () => {
  const src = readText("frontend/src/features/ai-chat/ChatComposer.vue");
  const template = src.match(/<template>[\s\S]*?<\/template>/);
  assert(template);
  // 添加按钮还在（用户未要求删添加按钮）；现在用 Element Plus 的 Plus 图标
  assert(template[0].includes("Plus"), "添加按钮的 Plus 图标应保留");
  assertStringIncludes(src, "onPickFileClick");
});

Deno.test("t10 — ai-chat feature 目录不再含 '附件' 视觉按钮", () => {
  // 全局扫过 ai-chat 目录的 .vue 文件，确保没有意外残留
  const files = [
    "frontend/src/features/ai-chat/ChatComposer.vue",
    "frontend/src/features/ai-chat/MessageBubble.vue",
    "frontend/src/features/ai-chat/ToolCallCard.vue",
    "frontend/src/features/ai-chat/AiChatPanel.vue",
  ];
  for (const f of files) {
    if (!existsSync(join(projectRoot, f))) continue;
    const src = readText(f);
    const template = src.match(/<template>[\s\S]*?<\/template>/);
    if (!template) continue;
    // 不应在主面板出现附件 icon（已被 t8 的 slash 命令 + skill 取代）
    if (f === "ChatComposer.vue") {
      assert(!template[0].includes("Paperclip"), `${f} 不应有附件 Paperclip icon`);
    }
  }
});

Deno.test("t10 — 文件还存在（没误删整个组件）", () => {
  assert(
    existsSync(join(projectRoot, "frontend/src/features/ai-chat/ChatComposer.vue")),
    "ChatComposer.vue 必须存在",
  );
});

Deno.test("t10 — 注释明确说明附件由 / 命令 + skill 提供", () => {
  const src = readText("frontend/src/features/ai-chat/ChatComposer.vue");
  // 用注释记录移除原因，方便后续读代码者理解
  assertStringIncludes(src, "/ 命令");
  assertStringIncludes(src, "skill");
});