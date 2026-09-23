/**
 * SSEWriter —— 把 AsyncIterable<StreamEvent> 渲染成 Server-Sent Events 帧
 *
 * 协议约定：
 *   - 单条 StreamEvent → 一个 SSE `data:` 帧（JSON 序列化）
 *   - done / error → 发完后结束流
 *   - 客户端断开 → 关闭底层迭代器（通过 AbortSignal 串到 ILLMClient.stream）
 *   - 心跳注释行（`: ping\n\n`）防止反向代理切断长连接
 */

import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";

export interface SseWriterOptions {
  /** 上游事件源（ILLMClient.stream 返回的迭代器） */
  source: AsyncIterable<StreamEvent>;
  /** 取消信号；客户端断开 AbortController.abort() */
  signal: AbortSignal;
  /** 心跳间隔（ms）；0 表示不发 */
  heartbeatMs?: number;
  /** 自定义 logger，便于测试 */
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

const encoder = new TextEncoder();

export async function writeSseStream(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  opts: SseWriterOptions,
): Promise<void> {
  const { source, signal, logger } = opts;
  const heartbeatMs = opts.heartbeatMs ?? 15000;

  let heartbeat: number | undefined;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      try {
        writer.write(encoder.encode(`: ping\n\n`)).catch(() => {/* dropped */});
      } catch {
        // dropped
      }
    }, heartbeatMs) as unknown as number;
  }

  try {
    for await (const ev of source) {
      if (signal.aborted) break;
      await writeEvent(writer, ev);
      if (ev.type === "done" || ev.type === "error") {
        break;
      }
    }
  } catch (e) {
    logger?.warn("SSE writer caught upstream error", {
      error: e instanceof Error ? e.message : String(e),
    });
    try {
      await writeEvent(writer, {
        type: "error",
        code: "STREAM_INTERRUPTED",
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
      });
    } catch {/* dropped */}
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    try {
      await writer.close();
    } catch {/* dropped */}
  }
}

async function writeEvent(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  ev: StreamEvent,
): Promise<void> {
  const payload = JSON.stringify(ev);
  await writer.write(encoder.encode(`data: ${payload}\n\n`));
}

/** 构造 SSE Response —— 标准的 text/event-stream header */
export function buildSseResponse(
  source: AsyncIterable<StreamEvent>,
  signal: AbortSignal,
  opts?: { heartbeatMs?: number; logger?: SseWriterOptions["logger"] },
): Response {
  const heartbeatMs = opts?.heartbeatMs ?? 15000;
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  // fire-and-forget; writes happen async
  void writeSseStream(writer, { source, signal, heartbeatMs, ...(opts?.logger ? { logger: opts.logger } : {}) });
  return new Response(stream.readable, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}