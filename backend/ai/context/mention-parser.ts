/**
 * MentionParser —— @项目名 语法解析
 *
 * 模式：`@<token>`，白名单字符 [\w一-鿿\-]+ （ASCII word + CJK + 连字符）
 * 多个 mention 用空白 / 标点 / 中英文逗号分隔
 *
 * 与 plan 一致：
 *   - 前端 + 后端**双重解析**（前端高亮、后端权威）
 *   - 找不到的 @xxx 降级为字面字符串，不报错
 */

export const MENTION_PATTERN = /@([\w一-鿿\-]+)/g;

/** 提取文本中所有 mention 的 raw token（不含 @） */
export function extractMentionTokens(input: string): string[] {
  if (!input) return [];
  // 重置 regex lastIndex（MENTION_PATTERN 是 module-level 单例）
  MENTION_PATTERN.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = MENTION_PATTERN.exec(input)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * 把 mention 切成段：literal / mention
 * 用于前端高亮
 */
export type Segment =
  | { kind: "literal"; text: string }
  | { kind: "mention"; token: string };

export function splitByMentions(input: string): readonly Segment[] {
  if (!input) return [];
  MENTION_PATTERN.lastIndex = 0;
  const segments: Segment[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_PATTERN.exec(input)) !== null) {
    if (m.index > cursor) {
      segments.push({ kind: "literal", text: input.slice(cursor, m.index) });
    }
    segments.push({ kind: "mention", token: m[1] });
    cursor = m.index + m[0].length;
  }
  if (cursor < input.length) {
    segments.push({ kind: "literal", text: input.slice(cursor) });
  }
  return segments;
}

/**
 * 把 mention 段转成 HTML 高亮（前端用；后端也可复用）
 *
 * 转义 < / > / & / "，避免 XSS
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

export function renderMentionsAsHtml(input: string, resolved?: ReadonlyMap<string, string>): string {
  const segments = splitByMentions(input);
  return segments
    .map((s) => {
      const esc = escapeHtml(s.kind === "mention" ? s.token : s.text);
      if (s.kind === "literal") return esc;
      const resolvedTo = resolved?.get(s.token);
      const titleAttr = resolvedTo ? ` title="project: ${escapeHtml(resolvedTo)}"` : ` title="unresolved mention"`;
      return `<span class="mention"${titleAttr}>@${esc}</span>`;
    })
    .join("");
}