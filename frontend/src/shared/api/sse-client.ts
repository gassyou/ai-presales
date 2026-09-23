/**
 * SSE 客户端 —— 解析 text/event-stream 为可观察的事件流
 *
 * 用 fetch + ReadableStream 读 chunk，Next 方便：
 *   - 不走 EventSource（更灵活，支持 POST）
 *   - 业务事件数据是 `data: <json>\n\n`，逐行解析
 *   - 注释行（`: ...`）作为心跳忽略
 */

import type { StreamEvent } from "@shared/types/dto/ai-session.ts";

export interface SseOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const decoder = new TextDecoder("utf-8");

/**
 * 消费一个 SSE Response，逐个产出 StreamEvent。
 * 末尾 done / error 之后自然结束。
 */
export async function* readSse(
  res: Response,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  if (!res.body) {
    throw new Error("SSE response has no body");
  }
  const reader = res.body.getReader();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // 按 SSE 帧分块：每个事件以 \n\n 结束
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const events = parseSseFrame(raw);
        for (const ev of events) yield ev;
      }
    }
    // 末尾若有残余，按 \n 拆
    if (buf.trim().length > 0) {
      for (const ev of parseSseFrame(buf)) yield ev;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {/* dropped */}
  }
}

function parseSseFrame(raw: string): StreamEvent[] {
  const out: StreamEvent[] = [];
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return out;
  const payload = dataLines.join("\n");
  try {
    const parsed = JSON.parse(payload) as StreamEvent;
    out.push(parsed);
  } catch {
    // 忽略无法解析的帧
  }
  return out;
}

/** 直接发起 POST，收到 Response 后让调用方消费 */
export async function postSse<T>(
  url: string,
  body: unknown,
  opts: SseOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...opts.headers,
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    let envelope: { code: string; message: string } | undefined;
    try {
      envelope = await res.json() as { code: string; message: string };
    } catch {/* non-json */}
    const msg = envelope ? `${envelope.code}: ${envelope.message}` : `HTTP ${res.status}`;
    const err = new Error(msg);
    (err as Error & { code?: string; httpStatus?: number }).code = envelope?.code;
    (err as Error & { code?: string; httpStatus?: number }).httpStatus = res.status;
    throw err;
  }
  return res;
}