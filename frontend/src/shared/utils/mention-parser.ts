/**
 * mention-parser —— 前端 @项目名 解析
 *
 * 与 backend/ai/context/mention-parser.ts 保持同一份正则；
 * 后端权威（再校验），前端只负责高亮 + 自动补全。
 *
 * 字符白名单：`[\w一-鿿\-]+`
 *   - ASCII word（含数字下划线）
 *   - 中日韩
 *   - hyphen（中划线，用于业务编号 "A-2025-001"）
 *
 * 多匹配：返回顺序为 in(tokens)
 */

/** 与后端保持一致的正则 */
export const MENTION_PATTERN = /@([\w一-鿿\-]+)/g;

/**
 * 提取所有 @xxx token，去重并保留首次出现顺序
 */
export function extractMentionTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_PATTERN)) {
    const tok = m[1];
    const key = tok.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tok);
    }
  }
  return out;
}

/**
 * 把文本切成 [前文, mention, 文本, mention, ...] 数组。
 * 非 mention 段落 type = 'text'；mention 段落 type = 'mention'。
 * 用于渲染时给 mention 加高亮 span。
 */
export type MentionSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mention"; readonly token: string };

export function splitByMentions(text: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(MENTION_PATTERN)) {
    const start = m.index ?? 0;
    if (start > cursor) out.push({ kind: "text", text: text.slice(cursor, start) });
    out.push({ kind: "mention", token: m[1] });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

/**
 * 把 mention 段渲染为 HTML 字符串（XSS safe —— token 已限制字符白名单）。
 * 用于 contenteditable 预览或消息气泡里的引用高亮。
 */
export function renderMentionsAsHtml(
  text: string,
  opts: { className?: string } = {},
): string {
  const cls = opts.className ?? "mention";
  // 字符已被白名单限定，escape 仅防 attribute 注入
  const escapeAttr = (s: string): string => s.replace(/"/g, "&quot;");
  const parts: string[] = [];
  let cursor = 0;
  for (const m of text.matchAll(MENTION_PATTERN)) {
    const start = m.index ?? 0;
    if (start > cursor) parts.push(escapeHtml(text.slice(cursor, start)));
    parts.push(`<span class="${cls}" data-mention="${escapeAttr(m[1])}">@${escapeHtml(m[1])}</span>`);
    cursor = start + m[0].length;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}