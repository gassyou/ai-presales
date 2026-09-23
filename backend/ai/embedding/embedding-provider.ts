/**
 * EmbeddingProvider —— 向量嵌入抽象
 *
 * 设计：
 *   - embed(texts) 批量 → Float32Array[]
 *   - providerName + modelId + dimension 写入每个 chunk 行（避免后续切换模型时 recall 失配）
 *   - 不可用 → 抛 EmbeddingUnavailableError，应用层决定如何处理
 *
 * 阶段 6.0c 实现：
 *   - OllamaEmbeddingProvider（默认，nomic-embed-text 768）
 *   - OpenAIEmbeddingProvider（text-embedding-3-small 1536）
 *   - DashScopeEmbeddingProvider（text-embedding-v2 1536）
 *   - MockEmbeddingProvider（开发/测试用，hash 模拟）
 */

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelId: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export class EmbeddingUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
    public readonly retryable: boolean,
  ) {
    super(`embedding provider "${provider}" unavailable: ${reason}`);
    this.name = "EmbeddingUnavailableError";
  }
}

export class EmbeddingDimensionMismatchError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`embedding dimension mismatch: expected ${expected}, got ${actual}`);
    this.name = "EmbeddingDimensionMismatchError";
  }
}