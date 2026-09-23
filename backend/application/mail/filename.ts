/**
 * filename.ts —— 邮件附件文件名消毒
 *
 * 阶段 7.4e。
 *
 * 规则（保守默认，按层级剥除 + 重写）：
 *   1. 截掉 NUL 字节（`\0`）
 *   2. 替换路径分隔符 `/` `\` 为 `_`
 *   3. `..` 字面（任何位置）→ `_` —— 防穿越
 *   4. 剥前导 `.`（防止 `.hidden` 和当前目录引用）
 *   5. 控制字符（< 0x20 或 == 0x7F）→ `_`
 *   6. 折叠连续空白为 `_`
 *   7. 总长截断到 200（保留扩展名）
 *   8. 加时间戳前缀 `<unix-ms-base36>-<rand8>-<safe>` 防重名
 *   9. 空 / 纯符号 → 抛错
 *
 * 注：磁盘层仍走 DB 路径 + `Deno.realPath` 防穿越；这是字符串层防御。
 */

const MAX_BASENAME = 200;
const PREFIX_TS_LEN = 10;
const PREFIX_RAND_LEN = 8;

function rand8(): string {
  const buf = new Uint8Array(PREFIX_RAND_LEN / 2);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sanitizeFilename(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("sanitizeFilename: input is not a string");
  }
  // 1. NUL → 空
  let s = raw.replace(/\0/g, "");
  // 2. 路径分隔符
  s = s.replace(/[\\/]/g, "_");
  // 3. `..` 字面
  s = s.replace(/\.\./g, "_");
  // 4. 控制字符
  s = s.replace(/[\x00-\x1f\x7f]/g, "_");
  // 5. 折叠连续空白为 `_`（但保留单个字符；不动 `.` 以保护扩展名）
  s = s.replace(/\s+/g, "_");
  // 6. 剥前导 `.`
  while (s.startsWith(".")) s = s.slice(1);
  // 7. 截断（保留扩展名）
  if (s.length > MAX_BASENAME) {
    const dot = s.lastIndexOf(".");
    if (dot > 0 && s.length - dot <= 20) {
      const ext = s.slice(dot);
      const base = s.slice(0, MAX_BASENAME - ext.length);
      s = base + ext;
    } else {
      s = s.slice(0, MAX_BASENAME);
    }
  }
  // 8. 空 / 全是 `_` 视为无效
  if (s.length === 0 || /^_+$/.test(s)) {
    throw new Error("sanitizeFilename: empty filename after sanitization");
  }
  // 9. 时间戳前缀
  const ts = Date.now().toString(36).slice(-PREFIX_TS_LEN);
  const rand = rand8();
  return `${ts}-${rand}-${s}`;
}