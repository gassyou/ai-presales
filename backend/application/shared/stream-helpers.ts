/**
 * 流式 sub-agent 输出收集工具（阶段 7.5 —— 清理 mock 占位）
 *
 * 用法：把 InvokeSubAgentUseCase.execute(...) 返的 AsyncIterable<StreamEvent>
 *       抽干成 markdown / 答案字符串。遇 terminal `error` 抛错；支持 AbortSignal。
 */

import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";

/**
 * 把 sub-agent 流抽干成字符串（拼接 chunk 事件的 delta）。
 *
 * 行为约定：
 *  - 跳过 tool_call / tool_result 事件（不计入正文）
 *  - 遇 terminal `{type:"error"}` → 抛 Error，message 含 code + message
 *  - 遇 `{type:"done"}` → 正常返回累积字符串
 *  - signal 已 aborted → 抛 AbortError
 *  - 流为空 → 返 `""`
 */
export async function collectStreamToString(
  stream: AsyncIterable<StreamEvent>,
  signal?: AbortSignal,
): Promise<string> {
  const parts: string[] = [];
  for await (const ev of stream) {
    if (signal?.aborted) {
      throw new DOMException("collectStreamToString aborted", "AbortError");
    }
    if (ev.type === "chunk") {
      parts.push(ev.delta);
    } else if (ev.type === "error") {
      throw new Error(`sub-agent stream failed: ${ev.code} - ${ev.message}`);
    }
    // tool_call / tool_result / done / ppt_page 都不计入正文
  }
  return parts.join("");
}