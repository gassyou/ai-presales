/**
 * 配置加载器 —— 读取 TOML → zod 校验 → ${ENV_VAR} 替换 → 与 env 合并 → 冻结
 *
 * 不引入第三方 TOML parser（Deno 2.x 已内置 `@std/toml`）。
 */

import { parse } from "@std/toml";
import { ConfigFileSchema, type ConfigFile } from "./schema.ts";
import type { AppConfig } from "./types.ts";
import { expandHome, defaultDataDir } from "../platform/paths.ts";

const CONFIG_PATH_ENV = "AI_PRESALES_CONFIG";

/** ${VAR} 替换；未设时回退到默认 data dir */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    const v = Deno.env.get(name);
    if (v !== undefined && v !== "") return v;
    // 唯一被允许的回退：APP_DATA_DIR
    if (name === "APP_DATA_DIR") return defaultDataDir();
    return match;
  });
}

/** 根据 provider 选择 env 中哪个 key 注入 apiKey */
function envApiKeyFor(provider: "anthropic" | "openai"): string | undefined {
  if (provider === "anthropic") {
    return Deno.env.get("ANTHROPIC_API_KEY") ?? undefined;
  }
  return Deno.env.get("OPENAI_API_KEY") ?? undefined;
}

/** 根据 provider 选择 env 中 baseUrl（可选覆盖） */
function envBaseUrlFor(provider: "anthropic" | "openai"): string | undefined {
  if (provider === "anthropic") {
    return Deno.env.get("ANTHROPIC_BASE_URL") ?? undefined;
  }
  return Deno.env.get("OPENAI_BASE_URL") ?? undefined;
}

function fileToAppConfig(file: ConfigFile): AppConfig {
  const profiles: AppConfig["profiles"] = {};
  for (const [name, p] of Object.entries(file.profiles)) {
    profiles[name] = {
      provider: p.provider,
      apiKey: envApiKeyFor(p.provider) ?? p.api_key,
      baseUrl: envBaseUrlFor(p.provider) ?? p.base_url,
      model: p.model,
      temperature: p.temperature,
      maxTokens: p.max_tokens,
    };
  }

  return {
    app: {
      name: file.app.name,
      version: file.app.version,
      dataDir: expandHome(interpolateEnv(file.app.data_dir)),
    },
    server: file.server,
    profiles,
    defaultProfile: file.default_profile,
    knowledge: {
      ragTopK: file.knowledge.rag_top_k,
      ragMinScore: file.knowledge.rag_min_score,
      embeddingProvider: file.knowledge.embedding_provider,
      embeddingModel: file.knowledge.embedding_model,
      embeddingDim: file.knowledge.embedding_dim,
      chunkMaxTokens: file.knowledge.chunk_max_tokens,
      chunkOverlapTokens: file.knowledge.chunk_overlap_tokens,
      softFallbackOnVecMissing: file.knowledge.soft_fallback_on_vec_missing,
      ...(file.knowledge.ollama
        ? {
          ollama: {
            ...(file.knowledge.ollama.base_url !== undefined
              ? { baseUrl: file.knowledge.ollama.base_url }
              : {}),
            ...(file.knowledge.ollama.model !== undefined ? { model: file.knowledge.ollama.model } : {}),
            ...(file.knowledge.ollama.dimension !== undefined
              ? { dimension: file.knowledge.ollama.dimension }
              : {}),
          },
        }
        : {}),
      ...(file.knowledge.openai
        ? {
          openai: {
            ...(file.knowledge.openai.api_key !== undefined
              ? { apiKey: file.knowledge.openai.api_key }
              : {}),
            ...(file.knowledge.openai.base_url !== undefined
              ? { baseUrl: file.knowledge.openai.base_url }
              : {}),
            ...(file.knowledge.openai.model !== undefined ? { model: file.knowledge.openai.model } : {}),
            ...(file.knowledge.openai.dimension !== undefined
              ? { dimension: file.knowledge.openai.dimension }
              : {}),
          },
        }
        : {}),
      ...(file.knowledge.dashscope
        ? {
          dashscope: {
            ...(file.knowledge.dashscope.api_key !== undefined
              ? { apiKey: file.knowledge.dashscope.api_key }
              : {}),
            ...(file.knowledge.dashscope.base_url !== undefined
              ? { baseUrl: file.knowledge.dashscope.base_url }
              : {}),
            ...(file.knowledge.dashscope.model !== undefined ? { model: file.knowledge.dashscope.model } : {}),
            ...(file.knowledge.dashscope.dimension !== undefined
              ? { dimension: file.knowledge.dashscope.dimension }
              : {}),
            ...(file.knowledge.dashscope.text_type !== undefined
              ? { textType: file.knowledge.dashscope.text_type }
              : {}),
          },
        }
        : {}),
    },
    security: {
      toolRequireApproval: file.security.tool_require_approval,
      allowedPaths: file.security.allowed_paths.map(expandHome),
    },
    output: {
      defaultOutputDir: expandHome(file.output.default_output_dir),
    },
    logging: {
      level: file.logging.level,
      file: file.logging.file,
      maxSizeMb: file.logging.max_size_mb,
      maxBackups: file.logging.max_backups,
    },
  };
}

export class ConfigLoadError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigLoadError";
    this.cause = cause;
  }
}

/**
 * 阶段 7.7（本地优先）：当 config.toml 不存在且用户未显式指定路径时，
 * **不再写任何文件到磁盘** —— 直接返回一份内存默认配置。
 *
 * 行为：
 *   - 找到 config.toml → 正常解析 + 校验 + 返回
 *   - 未找到（且非 explicit path）→ 返回 MINIMAL_APP_CONFIG_INMEMORY；warn 一次
 *   - 找到但解析/校验失败 → 抛 ConfigLoadError（不静默）
 *
 * AI provider profile / embedding 配置已不在此处；改由 SQLite `system_settings` 驱动。
 */
function buildMinimalAppConfig(): AppConfig {
  return Object.freeze({
    app: {
      name: "ai-presales",
      version: "0.1.0",
      // 每次重新计算以响应 APP_DATA_DIR / HOME 的变化（测试 + 跨平台）
      dataDir: defaultDataDir(),
    },
    server: {
      host: "127.0.0.1",
      port: 8000,
    },
    // AI 配置迁至 settings DB（system_settings.llm.profiles / knowledge.embedding）
    // 这里保留字段仅为类型完整性；运行时由 LLMClientResolver / EmbeddingProviderResolver 走 settings
    profiles: {},
    defaultProfile: "",
    knowledge: {
      ragTopK: 8,
      ragMinScore: 0.6,
      embeddingProvider: "mock" as const,
      embeddingModel: "mock-embed",
      embeddingDim: 0,
      chunkMaxTokens: 512,
      chunkOverlapTokens: 64,
      softFallbackOnVecMissing: false,
    },
    security: {
      toolRequireApproval: ["write_file", "shell"],
      allowedPaths: [],
    },
    output: {
      defaultOutputDir: "",
    },
    logging: {
      level: "info" as const,
      maxSizeMb: 10,
      maxBackups: 5,
    },
  });
}

let warnedOnce = false;
function warnMinimalConfigOnce(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    "[config] 未找到 config.toml，使用内存默认配置（无 AI provider）；" +
      "AI provider / embedding 请在 Settings 页面配置。",
  );
}

export async function loadConfig(path?: string): Promise<AppConfig> {
  const envPath = Deno.env.get(CONFIG_PATH_ENV);
  const explicit = path !== undefined || envPath !== undefined;
  const configPath = path ?? envPath ?? "config.toml";

  // 阶段 7.7：找不到 config.toml 且非显式指定 → 返回内存默认配置（不写文件）
  let raw: string | null = null;
  try {
    raw = await Deno.readTextFile(configPath);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      if (explicit) {
        throw new ConfigLoadError(
          `配置文件不存在: ${configPath}（已显式设置 ${CONFIG_PATH_ENV} 或 --config）`,
        );
      }
      // 隐式路径且文件不存在 → 内存默认
      warnMinimalConfigOnce();
      return buildMinimalAppConfig();
    }
    throw new ConfigLoadError(`读取配置文件失败: ${configPath}`, e);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (e) {
    throw new ConfigLoadError(`TOML 解析失败: ${configPath}`, e);
  }

  const validated = ConfigFileSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigLoadError(`配置校验失败:\n${issues}`);
  }

  return Object.freeze(fileToAppConfig(validated.data));
}

/** 内存中缓存的 appConfig（启动期一次加载） */
let cached: AppConfig | null = null;

export async function getAppConfig(): Promise<AppConfig> {
  if (cached) return cached;
  cached = await loadConfig();
  return cached;
}

/** 仅测试使用 */
export function _resetConfigForTest(): void {
  cached = null;
}