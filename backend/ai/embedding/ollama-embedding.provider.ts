/**
 * OllamaEmbeddingProvider —— 本地 Ollama embed
 *
 * 端点：POST {base_url}/api/embeddings
 * 请求：{ model, prompt }  （Ollama 0.1.x 老 API）
 * 响应：{ embedding: number[] }
 *
 * 失败：
 *   - 网络错误 → EmbeddingUnavailableError retryable
 *   - HTTP 4xx/5xx → EmbeddingUnavailableError non-retryable
 *
 * 适用：默认；零成本 / 离线友好
 */

import {
  EmbeddingUnavailableError,
  type EmbeddingProvider,
} from "./embedding-provider.ts";

export interface OllamaEmbeddingOptions {
  baseUrl?: string;
  model?: string;
  dimension?: number;
  /** 请求超时 ms */
  timeoutMs?: number;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "ollama";
  readonly modelId: string;
  readonly dimension: number;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaEmbeddingOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.modelId = opts.model ?? "nomic-embed-text";
    this.dimension = opts.dimension ?? 768;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const out: Float32Array[] = [];
    // Ollama 老 API 单次一条；批量串行
    for (const text of texts) {
      const vec = await this.embedOne(text);
      out.push(vec);
    }
    return out;
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.modelId, prompt: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new EmbeddingUnavailableError(
          this.providerName,
          `HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`,
          res.status >= 500,
        );
      }
      const json = (await res.json()) as { embedding?: number[] };
      if (!Array.isArray(json.embedding)) {
        throw new EmbeddingUnavailableError(
          this.providerName,
          "response missing 'embedding' array",
          false,
        );
      }
      return new Float32Array(json.embedding);
    } catch (e) {
      if (e instanceof EmbeddingUnavailableError) throw e;
      const isAbort = (e as { name?: string }).name === "AbortError";
      throw new EmbeddingUnavailableError(
        this.providerName,
        isAbort ? `timeout after ${this.timeoutMs}ms` : (e instanceof Error ? e.message : String(e)),
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}