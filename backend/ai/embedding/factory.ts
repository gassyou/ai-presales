/**
 * Embedding Provider 工厂 —— 按 settings DB 中的 embedding.provider 派发
 *
 * 配置（来自 SQLite system_settings.knowledge.embedding）：
 *   provider: "ollama" | "openai" | "dashscope" | "mock"
 *   baseUrl:  用户填的完整 URL（无内置默认）
 *   apiKey:   用户填的 key（mock / ollama 可空）
 *   model:    "nomic-embed-text" / "text-embedding-3-small" / ...
 *   dim:      768 / 1536 / ...
 *
 * 阶段 7.7：删除 forceMock 静默 fallback（用户要"未配置时返错 + 提示去 settings"）。
 * 调用方在 settings 未配置且 provider≠mock 时，会从 EmbeddingConfigSetting.create() 阶段就拒掉；
 * 此处只做 factory 派发，缺 apiKey 直接抛 EmbeddingUnavailableError。
 *
 * ENV 覆盖（向后兼容）：
 *   OPENAI_API_KEY     → OpenAI provider
 *   DASHSCOPE_API_KEY  → DashScope provider
 *   OLLAMA_BASE_URL    → Ollama provider baseUrl
 */

import { DashScopeEmbeddingProvider } from "./dashscope-embedding.provider.ts";
import {
  EmbeddingUnavailableError,
  type EmbeddingProvider,
} from "./embedding-provider.ts";
import { MockEmbeddingProvider } from "./mock-embedding.provider.ts";
import { OllamaEmbeddingProvider } from "./ollama-embedding.provider.ts";
import { OpenAIEmbeddingProvider } from "./openai-embedding.provider.ts";
import type { EmbeddingConfigSettingData } from "@backend/domain/settings/embedding-config.setting.ts";

export interface CreateEmbeddingProviderOptions {
  /** settings DB 中的 embedding 配置（已被 EmbeddingConfigSetting 校验过） */
  config: EmbeddingConfigSettingData;
  /** env 注入；env 仍优先（向后兼容 dev / CI） */
  env?: Record<string, string | undefined>;
}

function getEnv(env: Record<string, string | undefined> | undefined, key: string): string | undefined {
  return env?.[key];
}

export function createEmbeddingProvider(opts: CreateEmbeddingProviderOptions): EmbeddingProvider {
  const { config, env } = opts;
  switch (config.provider) {
    case "mock":
      return new MockEmbeddingProvider();
    case "ollama": {
      const ollamaBase = getEnv(env, "OLLAMA_BASE_URL") ?? config.baseUrl;
      if (!ollamaBase) {
        throw new EmbeddingUnavailableError("ollama", "Ollama baseUrl not set; please visit Settings → Embedding to configure", false);
      }
      return new OllamaEmbeddingProvider({
        baseUrl: ollamaBase,
        model: config.model,
        dimension: config.dimension,
      });
    }
    case "openai": {
      const apiKey = getEnv(env, "OPENAI_API_KEY") ?? config.apiKey;
      if (!apiKey) {
        throw new EmbeddingUnavailableError("openai", "OPENAI_API_KEY not set; please visit Settings → Embedding to configure", false);
      }
      const opts2: ConstructorParameters<typeof OpenAIEmbeddingProvider>[0] = {
        apiKey,
        model: config.model,
        dimension: config.dimension,
      };
      if (config.baseUrl) opts2.baseUrl = config.baseUrl;
      return new OpenAIEmbeddingProvider(opts2);
    }
    case "dashscope": {
      const apiKey = getEnv(env, "DASHSCOPE_API_KEY") ?? config.apiKey;
      if (!apiKey) {
        throw new EmbeddingUnavailableError("dashscope", "DASHSCOPE_API_KEY not set; please visit Settings → Embedding to configure", false);
      }
      const opts2: ConstructorParameters<typeof DashScopeEmbeddingProvider>[0] = {
        apiKey,
        model: config.model,
        dimension: config.dimension,
      };
      if (config.baseUrl) opts2.baseUrl = config.baseUrl;
      if (config.textType) opts2.textType = config.textType;
      return new DashScopeEmbeddingProvider(opts2);
    }
    default:
      throw new EmbeddingUnavailableError(
        config.provider as string,
        `unknown provider: ${String(config.provider)}`,
        false,
      );
  }
}