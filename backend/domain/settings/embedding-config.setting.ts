/**
 * EmbeddingConfigSetting —— 阶段 7.7（本地优先）
 *
 * Embedding provider 的运行时配置；纯函数 + 校验。
 *
 * 校验：
 *   - provider ∈ {ollama, openai, dashscope, mock}
 *   - provider=mock 时 apiKey/baseUrl 可空
 *   - provider=openai 时 apiKey 必填
 *   - provider=ollama 时 baseUrl 必填
 *   - provider=dashscope 时 apiKey 必填
 *   - dimension ∈ [1, 4096]
 *
 * 注：baseUrl / model 可由用户在 settings 页面手填；不再有内置默认 URL。
 */

import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";

export type EmbeddingProviderName = "ollama" | "openai" | "dashscope" | "mock";

export interface EmbeddingConfigSettingData {
  readonly provider: EmbeddingProviderName;
  /** 完整 base URL；openai 兼容模式下可指向任意第三方代理 */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly dimension: number;
  /** dashscope 专用 */
  readonly textType?: "query" | "document";
}

export class EmbeddingConfigSetting {
  private constructor(private readonly data: EmbeddingConfigSettingData) {}

  static create(input: EmbeddingConfigSettingData): DomainResult<EmbeddingConfigSetting> {
    if (!input || typeof input !== "object") {
      return domainErr("INVALID_INPUT", "embedding config must be object");
    }
    const allowed: EmbeddingProviderName[] = ["ollama", "openai", "dashscope", "mock"];
    if (!allowed.includes(input.provider)) {
      return domainErr("INVALID_INPUT", `provider must be one of ${allowed.join(", ")}`, { provider: input.provider });
    }
    if (!input.model || typeof input.model !== "string" || input.model.length === 0) {
      return domainErr("INVALID_INPUT", "model is required");
    }
    // dimension=0 是 mock provider 的合法值（mock 不产出真实向量）
    if (typeof input.dimension !== "number" || input.dimension < 0 || input.dimension > 4096) {
      return domainErr("INVALID_INPUT", "dimension must be in [0, 4096]", { dimension: input.dimension });
    }
    if (input.baseUrl !== undefined && (typeof input.baseUrl !== "string" || input.baseUrl.length === 0)) {
      return domainErr("INVALID_INPUT", "baseUrl must be non-empty string");
    }
    if (input.apiKey !== undefined && typeof input.apiKey !== "string") {
      return domainErr("INVALID_INPUT", "apiKey must be string");
    }
    // provider-specific required fields
    if (input.provider === "openai") {
      if (!input.apiKey || input.apiKey.length === 0) {
        return domainErr("INVALID_INPUT", "openai provider requires apiKey; please visit Settings → Embedding to configure");
      }
    } else if (input.provider === "dashscope") {
      if (!input.apiKey || input.apiKey.length === 0) {
        return domainErr("INVALID_INPUT", "dashscope provider requires apiKey; please visit Settings → Embedding to configure");
      }
    } else if (input.provider === "ollama") {
      if (!input.baseUrl || input.baseUrl.length === 0) {
        return domainErr("INVALID_INPUT", "ollama provider requires baseUrl; please visit Settings → Embedding to configure");
      }
    }
    if (input.textType !== undefined && input.textType !== "query" && input.textType !== "document") {
      return domainErr("INVALID_INPUT", "textType must be 'query' or 'document'");
    }
    return domainOk(new EmbeddingConfigSetting({
      provider: input.provider,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      model: input.model,
      dimension: input.dimension,
      ...(input.textType !== undefined ? { textType: input.textType } : {}),
    }));
  }

  get provider(): EmbeddingProviderName { return this.data.provider; }
  get baseUrl(): string | undefined { return this.data.baseUrl; }
  get apiKey(): string | undefined { return this.data.apiKey; }
  get model(): string { return this.data.model; }
  get dimension(): number { return this.data.dimension; }
  get textType(): "query" | "document" | undefined { return this.data.textType; }

  /** 给 EmbeddingProviderResolver / createEmbeddingProvider 用 */
  toJSON(): EmbeddingConfigSettingData {
    return {
      provider: this.data.provider,
      ...(this.data.baseUrl !== undefined ? { baseUrl: this.data.baseUrl } : {}),
      ...(this.data.apiKey !== undefined ? { apiKey: this.data.apiKey } : {}),
      model: this.data.model,
      dimension: this.data.dimension,
      ...(this.data.textType !== undefined ? { textType: this.data.textType } : {}),
    };
  }

  /** 阶段 7.7 启动期默认值：mock provider（无需 apiKey/URL） */
  static defaultMock(): EmbeddingConfigSettingData {
    return {
      provider: "mock",
      model: "mock-embed",
      dimension: 0,
    };
  }
}