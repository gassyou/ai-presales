/**
 * EmbeddingProviderResolver —— 阶段 7.7
 *
 * 跟 LLMClientResolver 同款：cache + invalidate。
 *
 * 设计：
 *   - 持一个 EmbeddingProvider（通常单实例）
 *   - get() 命中返回；未命中调 build() 构造
 *   - invalidate() 清空缓存（settings 改了之后调）
 *
 * 与 LLMClientResolver 区别：LLM 是按 profile 名分多实例；embedding 全 app 通常只有
 * 一个 provider；故 API 简化（无参数）。
 */

import type { EmbeddingProvider } from "@backend/ai/embedding/embedding-provider.ts";

export class EmbeddingProviderResolver {
  private cached: EmbeddingProvider | null = null;

  constructor(private readonly build: () => Promise<EmbeddingProvider>) {}

  async get(): Promise<EmbeddingProvider> {
    if (this.cached) return this.cached;
    this.cached = await this.build();
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }

  /** 仅测试用 —— 是否已 cache */
  has(): boolean {
    return this.cached !== null;
  }
}