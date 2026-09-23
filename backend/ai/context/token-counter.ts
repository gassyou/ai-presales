/**
 * TokenCounter —— 粗估 token 数（不依赖真 tokenizer）
 *
 * 启发式：
 *   - ASCII 字符：4 字符 ≈ 1 token
 *   - CJK 字符（U+4E00..U+9FFF + 全角符号）：1.5 字符 ≈ 1 token
 *   - 其他 Unicode：按字符长度算
 *
 * 误差 ~ ±15%，对预算分配足够（超长时走摘要兜底）。
 * 后续可换 tiktoken / anthropic-tokenizer；接口保持不变。
 */

const CJK_RE = /[　-〿㐀-䶿一-鿿＀-￯]/;

export interface TokenCounter {
  /** 估算字符串的 token 数（最小 1） */
  count(text: string): number;
  /** 估算多段拼接的总 token（messages 之间加 2 token 的 role/分隔开销） */
  countMessages(messages: readonly { content: string }[]): number;
}

export class CharacterBasedTokenCounter implements TokenCounter {
  count(text: string): number {
    if (!text) return 0;
    let asciiChars = 0;
    let cjkChars = 0;
    let otherChars = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 128) {
        asciiChars++;
      } else if (CJK_RE.test(ch)) {
        cjkChars++;
      } else {
        otherChars++;
      }
    }
    const asciiTokens = Math.ceil(asciiChars / 4);
    const cjkTokens = Math.ceil(cjkChars / 1.5);
    const otherTokens = otherChars;
    return Math.max(1, asciiTokens + cjkTokens + otherTokens);
  }

  countMessages(messages: readonly { content: string }[]): number {
    let total = 0;
    for (const m of messages) {
      total += this.count(m.content) + 2;  // role + 分隔
    }
    return total;
  }
}