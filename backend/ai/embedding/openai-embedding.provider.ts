/**
 * OpenAIEmbeddingProvider —— OpenAI text-embedding-3-small / large
 *
 * 端点：POST {base_url}/v1/embeddings
 * 请求：{ input: string|string[], model, encoding_format: "float" }
 * 响应：{ data: [{ embedding: number[], index }] }
 *
 * 失败：HTTP 4xx/5xx → EmbeddingUnavailableError
 */

import {
  EmbeddingUnavailableError,
  type EmbeddingProvider,
} from "./embedding-provider.ts";

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  dimension?: number;
  timeoutMs?: number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "openai";
  readonly modelId: string;
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OpenAIEmbeddingOptions) {
    if (!opts.apiKey) {
      throw new EmbeddingUnavailableError("openai", "missing api key", false);
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
    this.modelId = opts.model ?? "text-embedding-3-small";
    this.dimension = opts.dimension ?? 1536;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: [...texts],
          model: this.modelId,
          encoding_format: "float",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new EmbeddingUnavailableError(
          this.providerName,
          `HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`,
          res.status >= 500,
        );
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding?: number[]; index: number }>;
      };
      if (!Array.isArray(json.data)) {
        throw new EmbeddingUnavailableError(
          this.providerName,
          "response missing 'data' array",
          false,
        );
      }
      const indexed = new Map<number, number[]>();
      for (const item of json.data) {
        if (Array.isArray(item.embedding)) indexed.set(item.index, item.embedding);
      }
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i++) {
        const vec = indexed.get(i);
        if (!vec) {
          throw new EmbeddingUnavailableError(
            this.providerName,
            `missing embedding for input index ${i}`,
            false,
          );
        }
        out.push(new Float32Array(vec));
      }
      return out;
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