/**
 * 调查任务「已运行 N 秒」格式化纯函数。
 *
 * 输入：
 *   - startedAt: ISO 字符串；空/undefined → ""
 *   - nowMs: Date.now() 当前毫秒（注入便于测试）
 *
 * 输出：
 *   - elapsed < 60s          → "Ns"
 *   - elapsed >= 60s         → "Nm Ks"
 *   - elapsed < 0（时钟漂移）→ "0s"
 *   - startedAt 为空          → ""
 */

export function formatElapsed(
  startedAt: string | undefined | null,
  nowMs: number,
): string {
  if (!startedAt) return "";
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return "";
  const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}