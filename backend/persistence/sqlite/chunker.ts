/**
 * Chunker —— 文本切片器
 *
 * 切片策略：
 *   1. 按段落（\n\n / \n）优先切 —— 保持语义完整
 *   2. 段落超长 → 按句号优先切（。 / . / ！ / ？）
 *   3. 仍超长 → 按硬长度切
 *   4. 相邻块保留 chunkOverlapTokens 重叠字符，提升 RAG 召回边界质量
 *
 * 重要：
 *   - 输入是"字符感知"，不知道真实 token 数；调用方应传入 approxCharsPerToken（默认 2.5）
 *   - 输出每块带 ordinal（0..N-1）和 tokenCount（粗估）
 *   - 段落级切分对中文友好；英文按句号切
 */

export interface ChunkInput {
  readonly text: string;
  readonly chunkMaxTokens?: number;
  readonly chunkOverlapTokens?: number;
  /** 1 token ≈ N 字符；CJK 取 1.5、ASCII 取 4；默认 2.5 平衡 */
  readonly charsPerToken?: number;
}

export interface ChunkOutput {
  readonly ordinal: number;
  readonly text: string;
  readonly tokenCount: number;
}

const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 50;
const DEFAULT_CHARS_PER_TOKEN = 2.5;
const PARAGRAPH_BREAKS = /\n\s*\n/g;
const SENTENCE_BREAKS = /([。！？\.!?\n])/g;

function approxTokens(chars: number, cpt: number): number {
  return Math.ceil(chars / cpt);
}

export function chunkText(input: ChunkInput): ChunkOutput[] {
  const maxTokens = input.chunkMaxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = input.chunkOverlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const cpt = input.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const maxChars = Math.max(50, Math.floor(maxTokens * cpt));
  const overlapChars = Math.max(0, Math.floor(overlapTokens * cpt));

  const text = input.text;
  if (!text || text.trim().length === 0) return [];

  // 第一步：按段落切
  const paragraphs = text.split(PARAGRAPH_BREAKS).map((p) => p.trim()).filter((p) => p.length > 0);

  // 第二步：把段落拼成块，每块不超过 maxChars；段落本身超长则按句切
  const pieces: string[] = [];
  let buffer = "";
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (buffer.length > 0) {
        pieces.push(buffer);
        buffer = "";
      }
      // 按句切
      const sentences = splitBySentences(para);
      let sbuf = "";
      for (const s of sentences) {
        if (s.length > maxChars) {
          // 句本身超长 → 硬切
          if (sbuf.length > 0) {
            pieces.push(sbuf);
            sbuf = "";
          }
          for (const piece of hardSliceMany(s, maxChars)) pieces.push(piece);
        } else if ((sbuf + s).length > maxChars) {
          if (sbuf.length > 0) pieces.push(sbuf);
          sbuf = s;
        } else {
          sbuf += s;
        }
      }
      if (sbuf.length > 0) pieces.push(sbuf);
    } else if ((buffer + "\n\n" + para).length > maxChars) {
      pieces.push(buffer);
      buffer = para;
    } else {
      buffer = buffer.length === 0 ? para : `${buffer}\n\n${para}`;
    }
  }
  if (buffer.length > 0) pieces.push(buffer);

  // 第三步：加 overlap（除第一块外，每块开头追加前一块末尾 overlapChars）
  const withOverlap: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i === 0 || overlapChars === 0) {
      withOverlap.push(pieces[i]);
    } else {
      const prev = pieces[i - 1];
      const tail = prev.slice(Math.max(0, prev.length - overlapChars));
      withOverlap.push(`${tail}${pieces[i]}`);
    }
  }

  return withOverlap.map((t, i) => ({
    ordinal: i,
    text: t,
    tokenCount: approxTokens(t.length, cpt),
  }));
}

function splitBySentences(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  SENTENCE_BREAKS.lastIndex = 0;
  while ((match = SENTENCE_BREAKS.exec(text)) !== null) {
    const end = match.index + 1;
    if (end > last) {
      out.push(text.slice(last, end));
      last = end;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length > 0 ? out : [text];
}

function hardSliceMany(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + maxChars, text.length);
    if (end < text.length) {
      // 找最近的换行/空格
      const cut = text.slice(cursor, end);
      const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
      if (lastBreak > maxChars * 0.5) {
        end = cursor + lastBreak;
      }
    }
    const piece = text.slice(cursor, end);
    if (piece.length > 0) out.push(piece);
    cursor = end;
    if (cursor < text.length && (text[cursor] === " " || text[cursor] === "\n")) cursor++;
  }
  return out;
}