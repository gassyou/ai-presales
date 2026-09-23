/**
 * FakeTransport —— 单元 / 集成测试用
 *
 * 行为：
 *   - send() 录制请求（url/headers/body）+ 返回预设响应
 *   - 缺预设 → 抛错（让测试断言"调用了哪个 URL"）
 *
 * 用法：
 *   const t = new FakeTransport();
 *   t.reply("/v1/messages", { status: 200, body: <Anthropic response fixture> });
 *   const c = new AnthropicClient({ ..., transport: t });
 *   await c.chat(req);
 *   assertEquals(t.lastRequest?.url, "/v1/messages");
 */

import type { ITransport, TransportRequest, TransportResponse } from "@backend/ai/transport.ts";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

interface ReplyEntry<T> {
  status: number;
  body: T;
  match?: (req: TransportRequest) => boolean;
}

interface StreamEntry {
  chunks: unknown[];
  match?: (req: TransportRequest) => boolean;
}

export class FakeTransport implements ITransport {
  private readonly _replies = new Map<string, ReplyEntry<unknown>[]>();
  private readonly _streams = new Map<string, StreamEntry[]>();
  requests: RecordedRequest[] = [];

  /** 按 URL 挂一个回复；多个时按注册顺序消费 */
  reply<T>(url: string, status: number, body: T, opts?: { match?: (req: TransportRequest) => boolean }): void {
    let list = this._replies.get(url);
    if (!list) {
      list = [];
      this._replies.set(url, list);
    }
    const entry: ReplyEntry<T> = { status, body };
    if (opts?.match) entry.match = opts.match;
    list.push(entry);
  }

  /** 按 URL 挂一段 chunk 序列；调用 stream() 时按顺序吐 */
  streamResponse(url: string, chunks: unknown[], opts?: { match?: (req: TransportRequest) => boolean }): void {
    let list = this._streams.get(url);
    if (!list) {
      list = [];
      this._streams.set(url, list);
    }
    const entry: StreamEntry = { chunks };
    if (opts?.match) entry.match = opts.match;
    list.push(entry);
  }

  /** 按 URL 严格相等匹配消耗一次；找不到抛错 */
  async send<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    this.requests.push({ url: req.url, headers: { ...req.headers }, body: req.body });
    const list = this._replies.get(req.url);
    if (!list || list.length === 0) {
      throw new Error(`FakeTransport: no reply registered for ${req.url}`);
    }
    const entry = list.shift()!;
    if (entry.match && !entry.match(req)) {
      throw new Error(`FakeTransport: reply match predicate failed for ${req.url}`);
    }
    return { status: entry.status, body: entry.body as T };
  }

  async *stream(req: TransportRequest): AsyncIterable<unknown> {
    this.requests.push({ url: req.url, headers: { ...req.headers }, body: req.body });
    const list = this._streams.get(req.url);
    if (!list || list.length === 0) {
      throw new Error(`FakeTransport: no stream registered for ${req.url}`);
    }
    const entry = list.shift()!;
    if (entry.match && !entry.match(req)) {
      throw new Error(`FakeTransport: stream match predicate failed for ${req.url}`);
    }
    for (const c of entry.chunks) {
      // 模拟一点点网络延迟，让流式体验真实
      await new Promise((r) => setTimeout(r, 1));
      yield c;
    }
  }
}