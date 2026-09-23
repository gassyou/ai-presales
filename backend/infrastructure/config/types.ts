/**
 * 应用配置类型（运行时）
 *
 * 阶段 7.7（本地优先）：AI provider profile (`profiles`) 与 `defaultProfile` 字段
 * **保留仅为向后兼容**；运行时由 SQLite `system_settings` 驱动（见
 * `LLMProfilesSetting` / `LLMClientResolver`）。同理由 settings 驱动的还有
 * `knowledge.embedding*` 等字段 —— 本文件仅作为兜底 schema 与运维字段。
 */

export type ProviderName = "anthropic" | "openai";

export interface ProfileConfig {
  provider: ProviderName;
  /** OpenAI 兼容时可空；Anthropic 必须由 SDK 默认 */
  baseUrl?: string;
  /** 优先 env 注入；config 文件中的 key 仅作开发用 */
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface AppConfig {
  app: {
    name: string;
    version: string;
    dataDir: string;
  };
  server: {
    host: string;
    port: number;
  };
  /** @deprecated 由 system_settings.llm.profiles 驱动 */
  profiles: Record<string, ProfileConfig>;
  /** @deprecated 由 system_settings.llm.profiles.defaultProfile 驱动 */
  defaultProfile: string;
  knowledge: {
    ragTopK: number;
    ragMinScore: number;
    embeddingProvider: "ollama" | "openai" | "dashscope" | "mock";
    embeddingModel: string;
    embeddingDim: number;
    chunkMaxTokens: number;
    chunkOverlapTokens: number;
    softFallbackOnVecMissing: boolean;
    ollama?: { baseUrl?: string; model?: string; dimension?: number };
    openai?: { apiKey?: string; baseUrl?: string; model?: string; dimension?: number };
    dashscope?: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      dimension?: number;
      textType?: "query" | "document";
    };
  };
  security: {
    toolRequireApproval: string[];
    allowedPaths: string[];
  };
  output: {
    defaultOutputDir: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file?: string;
    maxSizeMb: number;
    maxBackups: number;
  };
}