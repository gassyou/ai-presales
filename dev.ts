/**
 * 开发入口
 *
 * - 加载配置
 * - 启 Deno.serve(:8000)
 * - CORS 打开，允许 vite dev server 跨域调用
 * - 不托管静态资源（前端跑在 vite dev 5173）
 * - DB probe 暂返回 null（阶段 1 还没装 DB）
 */

import { loadConfig } from "@backend/infrastructure/config/config.loader.ts";
import { createLogger } from "@backend/infrastructure/logging/logger.ts";
import { createApp } from "@backend/presentation/server.ts";
import { join } from "@std/path";
import { resolvePaths, ensureDir } from "@backend/infrastructure/platform/paths.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SdkTransport } from "@backend/ai/transport.sdk.ts";
import { createLlmClient } from "@backend/ai/client/client.factory.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import { buildBuiltinToolRegistry } from "@backend/ai/tool/builtin-tools.ts";
import { buildBuiltinSubAgentRegistry } from "@backend/application/sub-agent/builtin-sub-agents.ts";
// 阶段 6.0 装配
import { SystemClock } from "@backend/domain/shared/clock.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteKnowledgeRepository } from "@backend/persistence/sqlite/sqlite-knowledge.repository.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import { createEmbeddingProvider } from "@backend/ai/embedding/factory.ts";
import { SnapshotRegistry } from "@backend/ai/context/snapshot-registry.ts";
import { SqliteProjectSnapshotProvider } from "@backend/ai/context/providers/sqlite-project-snapshot.provider.ts";
import { SqliteRagProvider } from "@backend/ai/context/providers/sqlite-rag.provider.ts";
import { MentionResolver } from "@backend/ai/context/providers/mention-resolver.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";
import { ContextAssembler } from "@backend/ai/context/context-assembler.ts";
import { AdoptToKnowledgeUseCase } from "@backend/application/knowledge/adopt-to-knowledge.usecase.ts";
import { RetrieveUseCase } from "@backend/application/knowledge/retrieve.ts";
import { IngestProjectUseCase } from "@backend/application/knowledge/ingest-project.usecase.ts";
import { IndexStatusUseCase } from "@backend/application/knowledge/index-status.usecase.ts";
import { AutoAdoptFrequentlyCitedUseCase } from "@backend/application/ai/auto-adopt-frequently-cited.usecase.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import { MarkdownModuleService } from "@backend/application/business-module/markdown-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { PptUseCase } from "@backend/application/business-module/ppt.usecase.ts";
import { SqlitePptPagesRepository } from "@backend/persistence/sqlite/sqlite-ppt-pages.repository.ts";
import { EmbeddingUnavailableError } from "@backend/ai/embedding/embedding-provider.ts";
import { SqliteSystemSettingRepository } from "@backend/persistence/sqlite/sqlite-system-setting.repository.ts";
import { LLMProfilesSetting } from "@backend/domain/settings/llm-profiles.setting.ts";
import { EmbeddingProviderResolver } from "@backend/application/settings/embedding-resolver.ts";
import { EmbeddingConfigSetting } from "@backend/domain/settings/embedding-config.setting.ts";
import { SETTING_KEYS as SETTING_KEYS_ } from "@backend/domain/settings/system-setting.repository.ts";
import { DEFAULT_LLM_PROFILES } from "@backend/domain/settings/default-llm-profiles.ts";
const SETTING_KEYS_LLM_PROFILES = SETTING_KEYS_.LLM_PROFILES;
const SETTING_KEYS_EMBEDDING = SETTING_KEYS_.EMBEDDING;
// 阶段 7.4e：联系人 / 团队成员 / 邮件
import { SqliteProjectContactsRepository } from "@backend/persistence/sqlite/sqlite-project-contacts.repository.ts";
import { SqliteProjectTeamMembersRepository } from "@backend/persistence/sqlite/sqlite-project-team-members.repository.ts";
import { SqliteEmailRepository } from "@backend/persistence/sqlite/sqlite-email.repository.ts";
import { MailUseCase } from "@backend/application/mail/mail.usecase.ts";
import { FilesystemMailStorage } from "@backend/application/mail/mail.storage.ts";
// 阶段 7.4f：硬件清单 + 报价单
import { SqliteQuoteRunsRepository } from "@backend/persistence/sqlite/sqlite-quote-runs.repository.ts";
import { SqliteQuoteTemplatesRepository } from "@backend/persistence/sqlite/sqlite-quote-templates.repository.ts";
import { HardwareItemsUseCase } from "@backend/application/business-module/hardware-items.usecase.ts";
import { QuoteUseCase } from "@backend/application/quote/quote.usecase.ts";
import { FilesystemQuoteStorage } from "@backend/application/quote/quote.storage.ts";
import { ExceljsFiller } from "@backend/application/quote/exceljs-filler.ts";

const config = await loadConfig();
const logger = createLogger({ level: config.logging.level, context: { component: "dev" } });

const paths = resolvePaths();
await ensureDir(paths.data);
await ensureDir(paths.logs);
await ensureDir(paths.vendor);

const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;

logger.info("starting dev server", {
  mode: isDesktopMode ? "deno-desktop" : "deno-run",
  host: config.server.host,
  port: config.server.port,
  dataDir: config.app.dataDir,
});

const database = new Database({ paths });
await database.ready();
logger.info("database ready", { dataDir: paths.data });

const projectRepo = new SqliteProjectRepository(database);
// 阶段 7.4e：联系人 / 团队成员仓储提前建，让 projectService 一次性装配
const projectContactsRepo = new SqliteProjectContactsRepository(database);
const projectTeamRepo = new SqliteProjectTeamMembersRepository(database);
const projectService = new ProjectService({
  repo: projectRepo,
  contactsRepo: projectContactsRepo,
  teamRepo: projectTeamRepo,
});
const clock = new SystemClock();
// 阶段 7.7：dev 也走 settings DB 路径
const systemSettingsRepo = new SqliteSystemSettingRepository(database);

// seed 默认 LLM profiles + embedding config（dev 也需要，否则冷启首跑 AI 调用崩）
await systemSettingsRepo.seedIfEmpty(SETTING_KEYS_LLM_PROFILES, DEFAULT_LLM_PROFILES, clock);
await systemSettingsRepo.seedIfEmpty(SETTING_KEYS_EMBEDDING, EmbeddingConfigSetting.defaultMock(), clock);

const transport = new SdkTransport({
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
  openaiKey: Deno.env.get("OPENAI_API_KEY"),
});
const clientCache = new Map<string, ILLMClient>();
const clientInflight = new Map<string, Promise<ILLMClient>>();
async function resolveClient(profileName: string): Promise<ILLMClient> {
  const cached = clientCache.get(profileName);
  if (cached) return cached;
  const pending = clientInflight.get(profileName);
  if (pending) return pending;
  const p = (async () => {
    // 阶段 7.7（dev 模式）：从 settings 取 profile；dev 也走完整 settings 路径
    const c = await createLlmClient(profileName, {
      getProfile: async (name) => {
        const snap = await systemSettingsRepo.getLLMProfiles();
        if (!snap) return undefined;
        const vo = LLMProfilesSetting.create(snap.value);
        return vo.ok ? vo.value.resolveProfile(name) : undefined;
      },
      transport,
      env: {
        ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
        OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
      },
    });
    clientCache.set(profileName, c);
    return c;
  })();
  clientInflight.set(profileName, p);
  try { return await p; } finally { clientInflight.delete(profileName); }
}

const toolRegistry = buildBuiltinToolRegistry();
const subAgentResult = buildBuiltinSubAgentRegistry();
if (!subAgentResult.ok) {
  logger.error("failed to build sub-agent registry", { error: subAgentResult.error.message });
  Deno.exit(1);
}
const subAgentRegistry = subAgentResult.value;

// 阶段 6.0 装配
const sessionRepo = new SqliteAiSessionRepository(database);
const knowledgeRepo = new SqliteKnowledgeRepository(database);
const chunkRepo = new SqliteKnowledgeChunkRepository(database);
const tokenCounter = new CharacterBasedTokenCounter();

// 阶段 7.7：embedding 从 settings DB 取（dev 也走 settings 路径）
const embeddingResolver = new EmbeddingProviderResolver(async () => {
  const snap = await systemSettingsRepo.getEmbeddingConfig();
  const cfg = snap?.value ?? EmbeddingConfigSetting.defaultMock();
  const vo = EmbeddingConfigSetting.create(cfg);
  if (!vo.ok) {
    logger.warn("embedding config invalid; falling back to mock", { reason: vo.error.message });
    return createEmbeddingProvider({ config: EmbeddingConfigSetting.defaultMock() });
  }
  return createEmbeddingProvider({
    config: vo.value.toJSON(),
    env: {
      OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
      DASHSCOPE_API_KEY: Deno.env.get("DASHSCOPE_API_KEY"),
      OLLAMA_BASE_URL: Deno.env.get("OLLAMA_BASE_URL"),
    },
  });
});
let embeddingProvider = await embeddingResolver.get();
logger.info("embedding provider ready", {
  provider: embeddingProvider.providerName,
  model: embeddingProvider.modelId,
  dim: embeddingProvider.dimension,
});

const snapshotRegistry = new SnapshotRegistry();
const ragProvider = new SqliteRagProvider({
  retrieve: new RetrieveUseCase({ chunkRepo, embeddingProvider }),
  tokenCounter,
});
const projectSnapshotProvider = new SqliteProjectSnapshotProvider({
  projectRepo,
  chunkRepo,
  tokenCounter,
});
snapshotRegistry.registerRagProvider(ragProvider);
snapshotRegistry.registerProjectProvider(projectSnapshotProvider);

const mentionResolver = new MentionResolver({ projectRepo, chunkRepo });

const contextAssembler = new ContextAssembler({
  tokenCounter,
  registry: snapshotRegistry,
  config: {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },
});

const adoptUseCase = new AdoptToKnowledgeUseCase({
  knowledgeRepo,
  chunkRepo,
  embeddingProvider,
});
const ingestUseCase = new IngestProjectUseCase({
  sessionRepo,
  knowledgeRepo,
  chunkRepo,
  embeddingProvider,
});
const indexStatusUseCase = new IndexStatusUseCase({
  knowledgeRepo,
  chunkRepo,
  sessionRepo,
});
const autoAdoptUseCase = new AutoAdoptFrequentlyCitedUseCase({
  sessionRepo,
  knowledgeRepo,
  adopt: adoptUseCase,
  clock,
});
void autoAdoptUseCase;

const app = createApp({
  config,
  logger,
  staticRoot: undefined,        // dev 不托管静态资源
  devMode: true,                // 允许 vite 跨域
  dbProbe: async () => true,
  llmProbe: async () => {
    // 阶段 7.7：从 settings DB 读 profile 列表（dev 模式）
    const snap = await systemSettingsRepo.getLLMProfiles();
    const providers = snap ? snap.value.profiles.map((p) => p.name) : [];
    return { ok: true, providers };
  },
  projectService,
  clientResolver: resolveClient,
  subAgentRegistry,
  toolRegistry,
  toolCwd: config.app.dataDir,
  toolAllowedPaths: config.security.allowedPaths,
  knowledgeRoute: {
    logger,
    ingest: ingestUseCase,
    status: indexStatusUseCase,
    mentionResolver,
    clock,
  },
  clock,
  contextAssembler,
  sessionRepo,
  mentionResolver,
  businessModuleService: new BusinessModuleService({
    repo: new SqliteBusinessModuleRepository(database),
    clock,
  }),
  surveyTaskUseCase: new SurveyTaskUseCase({
    businessModuleService: new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    }),
    clock,
  }),
  surveyQuestionnaireUseCase: new SurveyQuestionnaireUseCase({
    businessModuleService: new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    }),
    clock,
  }),
  markdownModuleService: new MarkdownModuleService({
    businessModuleService: new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    }),
    clock,
  }),
  structuredModulesUseCase: new StructuredModulesUseCase(
    new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    }),
  ),
  // 阶段 7.4c：提案 PPT 设计
  pptUseCase: new PptUseCase(
    new SqlitePptPagesRepository(database),
    logger,
    clock,
  ),
  // 阶段 7.4e：联系人 / 团队成员 / 邮件
  projectContactsRoute: (() => {
    return { logger, contactsRepo: projectContactsRepo, teamRepo: projectTeamRepo, clock };
  })(),
  emailRoute: (() => {
    const mailRepo = new SqliteEmailRepository(database);
    const mailStorage = new FilesystemMailStorage(paths.data);
    const mailUseCase = new MailUseCase({
      repo: mailRepo,
      storage: mailStorage,
      clock,
      logger,
    });
    return { logger, useCase: mailUseCase, clock };
  })(),
  // 阶段 7.4f：硬件清单 + 报价单
  hardwareItemsRoute: (() => {
    const bmService = new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    });
    const hwUseCase = new HardwareItemsUseCase(bmService, clock);
    return { logger, useCase: hwUseCase };
  })(),
  quoteRoute: (() => {
    const bmService = new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    });
    const hwUseCase = new HardwareItemsUseCase(bmService, clock);
    const sm = new StructuredModulesUseCase(bmService);
    const quoteStorage = new FilesystemQuoteStorage(paths.data);
    const runsRepo = new SqliteQuoteRunsRepository(database);
    const templatesRepo = new SqliteQuoteTemplatesRepository(database);
    const quoteUseCase = new QuoteUseCase({
      hardwareUseCase: hwUseCase,
      structuredModules: sm,
      projectRepo,
      runsRepo,
      templatesRepo,
      storage: quoteStorage,
      filler: new ExceljsFiller(),
      clock,
      logger,
    });
    return { logger, useCase: quoteUseCase };
  })(),
  quoteTemplatesRoute: (() => {
    const bmService = new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    });
    const hwUseCase = new HardwareItemsUseCase(bmService, clock);
    const sm = new StructuredModulesUseCase(bmService);
    const quoteStorage = new FilesystemQuoteStorage(paths.data);
    const runsRepo = new SqliteQuoteRunsRepository(database);
    const templatesRepo = new SqliteQuoteTemplatesRepository(database);
    const quoteUseCase = new QuoteUseCase({
      hardwareUseCase: hwUseCase,
      structuredModules: sm,
      projectRepo,
      runsRepo,
      templatesRepo,
      storage: quoteStorage,
      filler: new ExceljsFiller(),
      clock,
      logger,
    });
    return { logger, useCase: quoteUseCase, storage: quoteStorage };
  })(),
});

const server = isDesktopMode
  ? Deno.serve(app.fetch)
  : Deno.serve(
    {
      hostname: config.server.host,
      port: config.server.port,
      onListen: ({ hostname, port }: { hostname: string; port: number }) => {
        logger.info(`listening on http://${hostname}:${port}`);
        logger.info(`vite dev expected at http://${hostname}:5173 (run 'deno task dev:frontend' in another terminal)`);
        logger.info(`health: curl http://${hostname}:${port}/api/health`);
      },
    },
    app.fetch,
  );

if (isDesktopMode) {
  const port = Deno.env.get("DENO_SERVE_ADDRESS")!.split(":").pop();
  // Deno.BrowserWindow 由 desktop 运行时注入；ambient 类型见 shared/types/deno-desktop.d.ts
  const BrowserWindow = (Deno as unknown as {
    BrowserWindow: new (opts?: unknown) => {
      navigate(url: string): void;
    };
  }).BrowserWindow;
  const win = new BrowserWindow({ title: "AI 提案协助 (dev)", width: 1280, height: 800 });
  win.navigate(`http://127.0.0.1:${port}/`);
  logger.info(`desktop window opened on http://127.0.0.1:${port}/`);
  logger.info("前端开发请另起一个终端跑: deno task dev:frontend");
}

await server.finished;

// 避免 unused import 警告（join 留给后续路径处理）
void join;
