/**
 * MockEmbeddingProvider —— 单元测试 + 开发模式
 *
 * 用 hash 模拟：相同文本 → 相同向量；维度可配
 * 不联网、可预测、零依赖
 */

import type { EmbeddingProvider } from "./embedding-provider.ts";

export interface MockEmbeddingOptions {
  model?: string;
  dimension?: number;
  /** 输出 L2-normalize 的单位向量（默认 true，便于 cosine 距离计算） */
  normalize?: boolean;
}

/** 简单字符串 hash（FNV-1a） */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — 确定性 PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "mock";
  readonly modelId: string;
  readonly dimension: number;
  private readonly normalize: boolean;

  constructor(opts: MockEmbeddingOptions = {}) {
    this.modelId = opts.model ?? "mock-embed-v1";
    this.dimension = opts.dimension ?? 768;
    this.normalize = opts.normalize ?? true;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const seed = fnv1a(t);
      const rand = mulberry32(seed);
      const v = new Float32Array(this.dimension);
      for (let i = 0; i < this.dimension; i++) v[i] = rand() * 2 - 1;
      if (this.normalize) {
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm);
        if (norm > 0) for (let i = 0; i < this.dimension; i++) v[i] /= norm;
      }
      return v;
    });
  }
}