/**
 * LLMProfilesSetting —— 阶段 7.4h；阶段 7.7 放宽
 *
 * LLM profile 集合的领域 VO；纯函数 + zod 校验。
 *
 * 校验：
 *   - profiles 非空
 *   - defaultProfile ⊆ profiles
 *   - 每个 profile：provider ∈ {anthropic, openai}，temperature ∈ [0, 2]，
 *     maxTokens ∈ [1, 1_000_000]
 *   - profile name 非空 + 不含特殊字符
 *
 * 阶段 7.7：apiKey / model / baseUrl 允许空字符串（启动期 seed 默认占位 profile）；
 * "是否真可用" 由 createLlmClient 运行时校验（缺 apiKey → 抛清晰错误）。
 */

import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import type { ProviderName } from "@backend/infrastructure/config/types.ts";

export interface LLMProfileConfig {
  /** profile 名（settings 内的主键） */
  readonly name: string;
  readonly provider: ProviderName;
  readonly baseUrl?: string;
  /** 明文 API key（用户接受） */
  readonly apiKey: string;
  readonly model: string;
  /** LLM temperature，OpenAI/Anthropic 通常 0~2 */
  readonly temperature: number;
  /** 单次响应最大 token 数 */
  readonly maxTokens: number;
}

export interface LLMProfilesSettingData {
  readonly defaultProfile: string;
  readonly profiles: readonly LLMProfileConfig[];
}

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/;

export class LLMProfilesSetting {
  private constructor(private readonly data: LLMProfilesSettingData) {}

  static create(input: LLMProfilesSettingData): DomainResult<LLMProfilesSetting> {
    if (!input || !Array.isArray(input.profiles) || input.profiles.length === 0) {
      return domainErr("INVALID_INPUT", "profiles must be a non-empty array");
    }
    if (!input.defaultProfile || typeof input.defaultProfile !== "string") {
      return domainErr("INVALID_INPUT", "defaultProfile is required");
    }
    const seen = new Set<string>();
    for (const p of input.profiles) {
      if (!p.name || !NAME_PATTERN.test(p.name)) {
        return domainErr("INVALID_INPUT", `invalid profile name: ${p.name}`);
      }
      if (seen.has(p.name)) {
        return domainErr("INVALID_INPUT", `duplicate profile name: ${p.name}`);
      }
      seen.add(p.name);
      if (p.provider !== "anthropic" && p.provider !== "openai") {
        return domainErr("INVALID_INPUT", `profile ${p.name}: provider must be anthropic|openai`, { provider: p.provider });
      }
      // 阶段 7.7：apiKey / model / baseUrl 允许空字符串（启动期 seed 默认占位）
      // "是否真可用" 由 createLlmClient 运行时校验
      if (typeof p.apiKey !== "string") {
        return domainErr("INVALID_INPUT", `profile ${p.name}: apiKey must be string`);
      }
      if (p.baseUrl !== undefined && (typeof p.baseUrl !== "string" || p.baseUrl.length === 0)) {
        return domainErr("INVALID_INPUT", `profile ${p.name}: baseUrl must be non-empty string (when set)`);
      }
      if (p.model !== undefined && (typeof p.model !== "string" || p.model.length === 0)) {
        return domainErr("INVALID_INPUT", `profile ${p.name}: model must be non-empty string (when set)`);
      }
      if (typeof p.temperature !== "number" || p.temperature < 0 || p.temperature > 2) {
        return domainErr("INVALID_INPUT", `profile ${p.name}: temperature must be in [0,2]`, { temperature: p.temperature });
      }
      if (typeof p.maxTokens !== "number" || p.maxTokens < 1 || p.maxTokens > 1_000_000) {
        return domainErr("INVALID_INPUT", `profile ${p.name}: maxTokens must be in [1, 1000000]`, { maxTokens: p.maxTokens });
      }
      if (p.baseUrl !== undefined && (typeof p.baseUrl !== "string" || p.baseUrl.length === 0)) {
        return domainErr("INVALID_INPUT", `profile ${p.name}: baseUrl must be non-empty string`);
      }
    }
    if (!seen.has(input.defaultProfile)) {
      return domainErr("INVALID_INPUT", `defaultProfile "${input.defaultProfile}" is not in profiles`);
    }
    return domainOk(new LLMProfilesSetting({
      defaultProfile: input.defaultProfile,
      profiles: Object.freeze(input.profiles.map((p) => ({
        name: p.name,
        provider: p.provider,
        ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
        apiKey: p.apiKey,
        model: p.model,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
      }))),
    }));
  }

  get defaultProfile(): string {
    return this.data.defaultProfile;
  }
  get profiles(): readonly LLMProfileConfig[] {
    return this.data.profiles;
  }

  /** 给 LLMClientResolver 用 —— 找默认 profile 快照 */
  resolveProfile(name: string): LLMProfileConfig | undefined {
    return this.data.profiles.find((p) => p.name === name);
  }

  /** 给 settings use case 把 data 序列化进 SQLite 用 */
  toJSON(): LLMProfilesSettingData {
    return {
      defaultProfile: this.data.defaultProfile,
      profiles: this.data.profiles.map((p) => ({
        name: p.name,
        provider: p.provider,
        ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
        apiKey: p.apiKey,
        model: p.model,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
      })),
    };
  }
}