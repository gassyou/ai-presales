/**
 * DashScopeEmbeddingProvider —— 阿里云 DashScope text-embedding-v2/v3
 *
 * 端点：POST {base_url}/api/v1/services/embeddings/text-embedding/text-embedding
 * 请求：{ model, input: { texts: string[] }, parameters: { text_type: "query" | "document" } }
 * 响应：{ output: { embeddings: { item: [{ embedding: number[], text_index }] } } }
 */

import {
  EmbeddingUnavailableError,
  type EmbeddingProvider,
} from "./embedding-provider.ts";

export interface DashScopeEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  dimension?: number;
  textType?: "query" | "document";
  timeoutMs?: number;
}

export class DashScopeEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "dashscope";
  readonly modelId: string;
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly textType: "query" | "document";
  private readonly timeoutMs: number;

  constructor(opts: DashScopeEmbeddingOptions) {
    if (!opts.apiKey) {
      throw new EmbeddingUnavailableError("dashscope", "missing api key", false);
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
    this.modelId = opts.model ?? "text-embedding-v2";
    this.dimension = opts.dimension ?? 1536;
    this.textType = opts.textType ?? "document";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/services/embeddings/text-embedding/text-embedding`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.modelId,
            input: { texts: [...texts] },
            parameters: { text_type: this.textType },
          }),
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        throw new EmbeddingUnavailableError(
          this.providerName,
          `HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`,
          res.status >= 500,
        );
      }
      const json = (await res.json()) as {
        output?: {
          embeddings?: {
            item?: Array<{ embedding?: number[]; text_index: number }>;
          };
        };
      };
      const items = json.output?.embeddings?.item;
      if (!Array.isArray(items)) {
        throw new EmbeddingUnavailableError(
          this.providerName,
          "response missing embeddings.item",
          false,
        );
      }
      const indexed = new Map<number, number[]>();
      for (const it of items) {
        if (Array.isArray(it.embedding)) indexed.set(it.text_index, it.embedding);
      }
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i++) {
        const vec = indexed.get(i);
        if (!vec) {
          throw new EmbeddingUnavailableError(
            this.providerName,
            `missing embedding for text_index ${i}`,
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