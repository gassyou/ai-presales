/**
 * Transport —— 适配器与 provider 网络层之间的薄接口
 *
 * 设计：
 *   - LLM 适配器只关心 canonical ↔ provider 的字段；
 *   - 网络层（HTTP 请求、流解析）抽到 Transport 里；
 *   - 测试时注入 FakeTransport，验证 adapter 不需要真 key 也能跑；
 *   - 生产用 SDK-based Transport（@anthropic-ai/sdk / openai）。
 *
 * 阶段 3 内 transport 实现是 stub；阶段 4 接入真实 SDK 与流式。
 */

export interface TransportRequest {
  readonly url: string;                 // "https://api.openai.com/v1/chat/completions"
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly signal?: AbortSignal;
}

export interface TransportResponse<T> {
  readonly status: number;
  readonly body: T;
  readonly headers?: Record<string, string>;
}

export interface ITransport {
  send<T>(req: TransportRequest): Promise<TransportResponse<T>>;
  /**
   * 流式读取：每个迭代项是一段 SSE 已解析的数据（不含 event: 行）。
   * 阶段 4：adapters 调 SDK 的 stream mode，传输层不再做 SSE 拼帧
   *         —— 各 provider 的 SSE 格式不同，adapters 在自己流里处理。
   *
   * 通用形态：每项是 provider-specific chunk JSON（已解析对象）。
   */
  stream?(req: TransportRequest): AsyncIterable<unknown>;
}

/** 错误包装 —— adapter 把 transport / SDK 异常归一为 LlmError */
export class LlmError extends Error {
  constructor(
    readonly code:
      | "LLM_AUTH_FAILED"
      | "LLM_RATE_LIMIT"
      | "LLM_UPSTREAM_ERROR"
      | "LLM_CONTEXT_OVERFLOW"
      | "LLM_BAD_REQUEST"
      | "LLM_INTERNAL",
    message: string,
    readonly retryable: boolean = false,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }

  static fromStatus(status: number, body: unknown): LlmError {
    const message = typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: unknown }).message)
      : `HTTP ${status}`;
    if (status === 401 || status === 403) return new LlmError("LLM_AUTH_FAILED", message, false, status);
    if (status === 429) return new LlmError("LLM_RATE_LIMIT", message, true, status);
    if (status === 400) return new LlmError("LLM_BAD_REQUEST", message, false, status);
    if (status >= 500) return new LlmError("LLM_UPSTREAM_ERROR", message, true, status);
    return new LlmError("LLM_INTERNAL", message, false, status);
  }
}