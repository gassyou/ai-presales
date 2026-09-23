/**
 * 配置 schema 校验（用 zod）
 *
 * 拒绝"散落的字符串"配置——所有配置必须经过 schema 验证后才是合法的 AppConfig。
 */

import { z } from "zod";

const ProfileSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  base_url: z.string().url().optional(),
  api_key: z.string().optional(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.5),
  max_tokens: z.number().int().positive().default(4096),
});

const AppSectionSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  data_dir: z.string().min(1),
});

const ServerSectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(8000),
});

const EmbeddingOllamaSchema = z.object({
  base_url: z.string().url().optional(),
  model: z.string().min(1).optional(),
  dimension: z.number().int().positive().optional(),
}).optional();

const EmbeddingOpenAISchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  model: z.string().min(1).optional(),
  dimension: z.number().int().positive().optional(),
}).optional();

const EmbeddingDashScopeSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  model: z.string().min(1).optional(),
  dimension: z.number().int().positive().optional(),
  text_type: z.enum(["query", "document"]).optional(),
}).optional();

const KnowledgeSectionSchema = z.object({
  rag_top_k: z.number().int().positive().default(8),
  rag_min_score: z.number().min(0).max(1).default(0.6),
  embedding_provider: z.enum(["ollama", "openai", "dashscope", "mock"]).default("ollama"),
  embedding_model: z.string().min(1).default("nomic-embed-text"),
  embedding_dim: z.number().int().positive().default(768),
  chunk_max_tokens: z.number().int().positive().default(500),
  chunk_overlap_tokens: z.number().int().nonnegative().default(50),
  soft_fallback_on_vec_missing: z.boolean().default(true),
  ollama: EmbeddingOllamaSchema,
  openai: EmbeddingOpenAISchema,
  dashscope: EmbeddingDashScopeSchema,
});

const SecuritySectionSchema = z.object({
  tool_require_approval: z.array(z.string()).default([]),
  allowed_paths: z.array(z.string()).default([]),
});

const OutputSectionSchema = z.object({
  default_output_dir: z.string().min(1),
});

const LoggingSectionSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  file: z.string().optional(),
  max_size_mb: z.number().int().positive().default(10),
  max_backups: z.number().int().nonnegative().default(5),
});

/**
 * 顶层 schema：profiles 是动态 key，用 passthrough 接收；通过 .refine 做交叉校验
 */
export const ConfigFileSchema = z
  .object({
    app: AppSectionSchema,
    server: ServerSectionSchema.default({ host: "127.0.0.1", port: 8000 }),
    profiles: z.record(z.string(), ProfileSchema).refine(
      (obj) => Object.keys(obj).length > 0,
      { message: "至少定义一个 profile" },
    ),
    default_profile: z.string().min(1),
    knowledge: KnowledgeSectionSchema.default({
      rag_top_k: 8,
      rag_min_score: 0.6,
      embedding_provider: "ollama",
      embedding_model: "nomic-embed-text",
      embedding_dim: 768,
      chunk_max_tokens: 500,
      chunk_overlap_tokens: 50,
      soft_fallback_on_vec_missing: true,
    }),
    security: SecuritySectionSchema.default({
      tool_require_approval: [],
      allowed_paths: [],
    }),
    output: OutputSectionSchema,
    logging: LoggingSectionSchema.default({
      level: "info",
      max_size_mb: 10,
      max_backups: 5,
    }),
  })
  .refine(
    (cfg) => cfg.default_profile in cfg.profiles,
    { message: "default_profile 必须指向已定义的 profile", path: ["default_profile"] },
  );

export type ConfigFile = z.infer<typeof ConfigFileSchema>;