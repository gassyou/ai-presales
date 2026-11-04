/**
 * 应用装配（composition root）—— main.ts（生产 / 桌面）与 dev.ts（开发）共用。
 *
 * 为什么要抽出来：
 *   之前两个入口各手写一份 createApp({...}) 装配清单。dev.ts 那份是手抄的，
 *   少了 9 个依赖（chat session / 附件 / dashboard / settings / skill /
 *   auto-mode / profileSnapshot / invokeSubAgentUseCase），于是 dev 模式下
 *   这些接口一律 501（backend/presentation/server.ts 里每个路由的 "not wired" 分支）。
 *   prod 一直正常，所以这个漂移只在开发态显形 —— 而开发态才是每天在用的那个。
 *
 *   装配清单只留一份，漂移就没有藏身之处。
 *
 * 两个入口真正的差异只有三项，全在 RuntimeOptions 里：
 *   devMode（dev 放开 CORS 给 vite）/ staticRoot（prod 托管 dist，dev 不托管）/ 日志组件名。
 *
 * 装配顺序有讲究（见下方注释）：settings use case 要先于 profileSnapshot 读，
 * invokeSubAgent 闭包要早于引用它的 use case —— 顺序错了不会报错，只会静默降级。
 */

import { loadConfig } from "@backend/infrastructure/config/config.loader.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import { createLogger } from "@backend/infrastructure/logging/logger.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import { type App, createApp } from "@backend/presentation/server.ts";
import { type AppPaths, ensureDir, resolvePaths } from "@backend/infrastructure/platform/paths.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SdkTransport } from "@backend/ai/transport.sdk.ts";
import { createLlmClient } from "@backend/ai/client/client.factory.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import {
  buildBuiltinToolRegistry,
  registerWriteableTools,
} from "@backend/ai/tool/builtin-tools.ts";
import { InvokeSubAgentUseCase } from "@backend/application/sub-agent/invoke-sub-agent.usecase.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";
// 阶段 H：写工具注册（写在 getProjectMeta 里需要 ProjectId 类型）
import type { ProjectId } from "@shared/types/ids.ts";
// 阶段 6.0 装配
import { SystemClock } from "@backend/domain/shared/clock.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
// 阶段 13（PR #4）：chat session route 接线
import { SqliteChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
// 阶段 13（PR #5）：skill 系统 —— 默认 registry + 3 个 builtin skill
import { buildDefaultSkillRegistry, type SkillRegistry } from "@backend/ai/skill/skill.ts";
import { makeBuiltinSkills } from "@backend/ai/skill/builtin-skills.ts";
// 阶段 13（PR #7）：chat 附件上传（migration 015 + repo + use case + route）
import { SqliteChatAttachmentRepository } from "@backend/persistence/sqlite/sqlite-chat-attachment.repository.ts";
import { ChatAttachmentUseCase } from "@backend/application/chat-attachment/chat-attachment.usecase.ts";
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
import { EmbeddingProviderResolver } from "@backend/application/settings/embedding-resolver.ts";
import { EmbeddingConfigSetting } from "@backend/domain/settings/embedding-config.setting.ts";
import { SETTING_KEYS as SETTING_KEYS_ } from "@backend/domain/settings/system-setting.repository.ts";
import { DEFAULT_LLM_PROFILES } from "@backend/domain/settings/default-llm-profiles.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import { MarkdownModuleService } from "@backend/application/business-module/markdown-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { PptUseCase } from "@backend/application/business-module/ppt.usecase.ts";
import { SqlitePptPagesRepository } from "@backend/persistence/sqlite/sqlite-ppt-pages.repository.ts";
// 阶段 7.4e：联系人 / 团队成员 / 邮件
import { SqliteProjectContactsRepository } from "@backend/persistence/sqlite/sqlite-project-contacts.repository.ts";
import { SqliteProjectTeamMembersRepository } from "@backend/persistence/sqlite/sqlite-project-team-members.repository.ts";
import { SqliteEmailRepository } from "@backend/persistence/sqlite/sqlite-email.repository.ts";
import { MailUseCase } from "@backend/application/mail/mail.usecase.ts";
import { FilesystemMailStorage } from "@backend/application/mail/mail.storage.ts";
// 阶段 7.4f：硬件设备清单 + 报价单
import { SqliteQuoteRunsRepository } from "@backend/persistence/sqlite/sqlite-quote-runs.repository.ts";
import { SqliteQuoteTemplatesRepository } from "@backend/persistence/sqlite/sqlite-quote-templates.repository.ts";
import { HardwareItemsUseCase } from "@backend/application/business-module/hardware-items.usecase.ts";
import { QuoteUseCase } from "@backend/application/quote/quote.usecase.ts";
import { FilesystemQuoteStorage } from "@backend/application/quote/quote.storage.ts";
import { ExceljsFiller } from "@backend/application/quote/exceljs-filler.ts";
// 阶段 7.4g：仪表盘
import { DashboardUseCase } from "@backend/application/dashboard/dashboard.usecase.ts";
// 阶段 7.4h：系统设置
import { SettingsUseCase } from "@backend/application/settings/settings.usecase.ts";
import { LLMClientResolver } from "@backend/application/settings/llm-client-resolver.ts";
import { SqliteSystemSettingRepository } from "@backend/persistence/sqlite/sqlite-system-setting.repository.ts";
import { SqliteBackedSubAgentRegistry } from "@backend/persistence/sqlite/sqlite-sub-agent-registry.ts";
import { ConfigurableToolRegistry } from "@backend/application/settings/configurable-tool-registry.ts";
import { LLMProfilesSetting } from "@backend/domain/settings/llm-profiles.setting.ts";
import { getBuiltinSubAgentSpecs } from "@backend/application/sub-agent/builtin-sub-agents.ts";
import { createSmtpTransport } from "@backend/infrastructure/mail/smtp-transport.ts";
// 阶段 13（PR #9）：auto-mode 全流水线
import { AutoModeOrchestrator } from "@backend/ai/auto-mode/orchestrator.ts";
import { DefaultAutoModeContextProvider } from "@backend/ai/auto-mode/default-context-provider.ts";
import { SubAgentAutoModeWorker } from "@backend/ai/auto-mode/sub-agent-worker.ts";
import { makeSubAgentReviewer } from "@backend/ai/auto-mode/sub-agent-reviewer.ts";
import {
  asSubAgentRunner,
  AutoModeRunnerAdapter,
} from "@backend/ai/auto-mode/invoke-sub-agent-runner.adapter.ts";

const SETTING_KEYS_LLM_PROFILES = SETTING_KEYS_.LLM_PROFILES;
const SETTING_KEYS_EMBEDDING = SETTING_KEYS_.EMBEDDING;

export interface RuntimeOptions {
  /** 开发态：放开 CORS 给 vite dev server */
  readonly devMode: boolean;
  /** 静态资源根目录；undefined = 不托管静态（dev 模式，前端跑在 vite） */
  readonly staticRoot?: string;
  /** 日志组件名（main / dev / test） */
  readonly logContext: string;
}

export interface Runtime {
  readonly app: App;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly paths: AppPaths;
}

/** 装配整个应用 —— main.ts 与 dev.ts 都调它 */
export async function buildRuntime(options: RuntimeOptions): Promise<Runtime> {
  const { devMode, staticRoot, logContext } = options;

  const config = await loadConfig();
  const logger = createLogger({ level: config.logging.level, context: { component: logContext } });

  const paths = resolvePaths();
  await ensureDir(paths.data);
  await ensureDir(paths.logs);
  await ensureDir(paths.vendor);

  const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;

  logger.info("starting app", {
    mode: isDesktopMode ? "deno-desktop" : "deno-run",
    host: config.server.host,
    port: config.server.port,
    dataDir: config.app.dataDir,
    devMode,
    staticRoot: staticRoot ?? null,
  });

  const database = new Database({ paths });
  await database.ready();
  logger.info("database ready", { dataDir: paths.data });

  // 阶段 7.7：settings repo 提前到 embeddingResolver prime 之前需要用
  const systemSettingsRepo = new SqliteSystemSettingRepository(database);

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

  // 阶段 13（PR #7）：fallback profile —— 当 settings 还没加载时用 config.profiles[defaultProfile]
  const fakeProfile: AppConfig["profiles"][string] = (() => {
    const p = config.profiles[config.defaultProfile];
    return p ?? { provider: "openai", model: "gpt-4o-mini", temperature: 0.2, maxTokens: 2048 };
  })();

  /**
   * 阶段 13（PR #7）：把异步的 llmClientResolver 包成同步可传的 ILLMClient。
   * chat() 调用时 lazy 触发 resolver；任何错误（resolver 未就绪 / LLM 不可用）都会被
   * 上层 try/catch 吞掉，AI 解析失败 ≠ upload 失败。
   */
  function makeLazyLlmClient(
    resolver: { get(name: string): Promise<ILLMClient> },
    profileName: string,
  ): ILLMClient {
    let cached: ILLMClient | null = null;
    return {
      provider: "openai",
      async chat(req) {
        if (cached === null) {
          cached = await resolver.get(profileName);
        }
        return await cached.chat(req);
      },
      async *stream(req) {
        if (cached === null) {
          cached = await resolver.get(profileName);
        }
        yield* cached.stream(req);
      },
      capabilities() {
        return {
          provider: "openai",
          supportsTools: false,
          supportsStreaming: true,
          supportsStructuredOutput: false,
          contextWindow: 128000,
        };
      },
    };
  }

  // LLM client factory —— 阶段 7.7：从 settings DB 取 profile（不再走 config.profiles）
  const transport = new SdkTransport({
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
    openaiKey: Deno.env.get("OPENAI_API_KEY"),
  });
  const llmClientResolver = new LLMClientResolver(async (profileName) => {
    return createLlmClient(profileName, {
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
  });
  async function resolveClient(profileName: string): Promise<ILLMClient> {
    return llmClientResolver.get(profileName);
  }

  // ---------- 阶段 6.0 装配：知识库 + 上下文 ----------
  const sessionRepo = new SqliteAiSessionRepository(database);
  const knowledgeRepo = new SqliteKnowledgeRepository(database);
  const chunkRepo = new SqliteKnowledgeChunkRepository(database);
  const tokenCounter = new CharacterBasedTokenCounter();

  // Embedding provider —— 阶段 7.7：从 settings DB 取配置；未配置时（provider=mock 为唯一默认可选项）
  // 静默用 mock，其他 provider 缺 apiKey/baseUrl 则 EmbeddingConfigSetting.create 阶段就拒掉。
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
  const embeddingProvider = await embeddingResolver.get();
  logger.info("embedding provider ready", {
    provider: embeddingProvider.providerName,
    model: embeddingProvider.modelId,
    dim: embeddingProvider.dimension,
  });

  // 阶段 7.5（H12）：RetrieveUseCase 提到外层，让 search_knowledge 工具与 SqliteRagProvider 共享
  const retrieveUseCase = new RetrieveUseCase({ chunkRepo, embeddingProvider });

  // SnapshotRegistry —— RAG + project snapshot
  const snapshotRegistry = new SnapshotRegistry();
  const ragProvider = new SqliteRagProvider({
    retrieve: retrieveUseCase,
    tokenCounter,
  });
  const projectSnapshotProvider = new SqliteProjectSnapshotProvider({
    projectRepo,
    chunkRepo,
    tokenCounter,
  });
  snapshotRegistry.registerRagProvider(ragProvider);
  snapshotRegistry.registerProjectProvider(projectSnapshotProvider);

  // MentionResolver
  const mentionResolver = new MentionResolver({ projectRepo, chunkRepo });

  // ContextAssembler —— 给 sub-agent 装配上下文用
  // 阶段 7.7：maxTokens 从 settings DB 读 default profile；构造移到 settingsUseCase 之后
  let contextAssembler!: ContextAssembler;
  function buildContextAssemblerFromSettings(): void {
    const defMax = (() => {
      const snap = settingsUseCase.cachedLLMProfiles();
      if (snap) {
        const def = snap.value.profiles.find((p) => p.name === snap.value.defaultProfile);
        if (def) return def.maxTokens;
      }
      return 8_192;
    })();
    contextAssembler = new ContextAssembler({
      tokenCounter,
      registry: snapshotRegistry,
      config: {
        contextWindow: defMax ? Math.max(200_000, defMax * 10) : 200_000,
        maxOutputTokens: defMax || 8_192,
      },
    });
  }

  // Knowledge use cases
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
  void autoAdoptUseCase; // 后续启动 background job 调用

  // Sub-Agent + Tool Registry —— read_module 工具需要 snapshot registry 注入
  // 阶段 7.5（H12 修复）：searchKnowledge 注入 retrieve，4 个 sub-agent 的 RAG 真正生效
  const toolRegistry = buildBuiltinToolRegistry({
    readModule: {
      projectRepo,
      chunkRepo,
      registry: snapshotRegistry,
      tokenCounter,
    },
    searchKnowledge: { retrieve: retrieveUseCase },
  });

  // ---------- 阶段 7.4h：settings + sub-agent registry（DB-backed） ----------
  // 阶段 7.7：seed 默认 LLM profiles + embedding config（空占位，用户在 Settings 里填）
  await systemSettingsRepo.seedIfEmpty(
    SETTING_KEYS_LLM_PROFILES,
    DEFAULT_LLM_PROFILES,
    clock,
  );
  await systemSettingsRepo.seedIfEmpty(
    SETTING_KEYS_EMBEDDING,
    EmbeddingConfigSetting.defaultMock(),
    clock,
  );

  // seed agents.specs（启动期 idempotent）：首次启动写入 5 个 builtin
  const seedSpecsData = {
    specs: Object.fromEntries(getBuiltinSubAgentSpecs().map((s) => [s.name, s])),
  };
  await systemSettingsRepo.seedIfEmpty(
    "agents.specs" as import("@backend/domain/settings/system-setting.repository.ts").SystemSettingKey,
    seedSpecsData,
    clock,
  );

  const subAgentRegistry = new SqliteBackedSubAgentRegistry(systemSettingsRepo);
  await subAgentRegistry.refreshSyncCacheAsync();
  logger.info("sub-agent registry ready", { agents: subAgentRegistry.names() });

  // 阶段 7.5：构造共享 InvokeSubAgentUseCase，导出 invokeSubAgent 闭包给所有需要 LLM 的 use case
  // （留到 settingsUseCase 构造之后再 new —— 需要从 settings 取 defaultProfileName）
  let invokeSubAgentUseCase!: InvokeSubAgentUseCase;
  let invokeSubAgent!: (
    subAgentName: string,
    userInput: string,
    opts?: { signal?: AbortSignal },
  ) => AsyncIterable<import("@backend/ai/message/canonical-message.ts").StreamEvent>;
  function buildInvokeSubAgentClosure(defaultProfileName: string): void {
    invokeSubAgentUseCase = new InvokeSubAgentUseCase({
      subAgentRegistry,
      toolRegistry,
      clientResolver: resolveClient,
      logger,
      cwd: config.app.dataDir,
      allowedPaths: config.security.allowedPaths,
      defaultProfileName,
    });
    invokeSubAgent = (
      subAgentName: string,
      userInput: string,
      opts?: { signal?: AbortSignal },
    ): AsyncIterable<import("@backend/ai/message/canonical-message.ts").StreamEvent> => {
      // 从 spec.toolNames 解析 tool spec（绕开 InvokeSubAgentUseCase 内部那个未实现的取值 bug）
      const spec = subAgentRegistry.get(subAgentName);
      const tools = spec
        ? spec.toolNames.flatMap((name) => {
          const t = toolRegistry.get(name);
          return t
            ? [{ name: t.name, description: t.description, inputSchema: t.inputSchema }]
            : [];
        })
        : [];
      // 阶段 7.7：execute() 现在是 async（要 await clientResolver 拿 client）。
      // 调用方期望 AsyncIterable，所以包一个 async iterator —— 第一次 next() 才触发 execute，
      // 错误会延迟到第一次迭代时抛（保留原有调用约定）。
      const promise = invokeSubAgentUseCase.execute({
        subAgentName,
        userInput,
        tools,
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      });
      return {
        [Symbol.asyncIterator]() {
          let started = false;
          let inner:
            | AsyncIterator<import("@backend/ai/message/canonical-message.ts").StreamEvent>
            | null = null;
          return {
            async next() {
              if (!started) {
                started = true;
                inner = (await promise)[Symbol.asyncIterator]();
              }
              return inner!.next();
            },
          };
        },
      };
    };
  }

  // 阶段 H：把 7 个写工具注册到 registry
  // 在 deps 装配之前，先建出 write tools 需要的 service
  const businessModuleServiceForWrites = new BusinessModuleService({
    repo: new SqliteBusinessModuleRepository(database),
    clock,
    invokeSubAgent,
    getProjectMeta: async (projectId: ProjectId) => {
      const r = await projectService.getProject(projectId);
      if (!r.ok) return null;
      return { name: r.value.name, clientName: r.value.clientName };
    },
  });
  // 阶段 B-sprint13：ReadMarkdownModuleTool 需要独立的 MarkdownModuleService（与上面的 BMService 配套）
  const markdownModuleServiceForWrites = new MarkdownModuleService({
    businessModuleService: businessModuleServiceForWrites,
    clock,
  });
  const surveyTaskUseCaseForWrites = new SurveyTaskUseCase({
    businessModuleService: new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    }),
    clock,
    invokeSubAgent,
  });
  const surveyQuestionnaireUseCaseForWrites = new SurveyQuestionnaireUseCase({
    businessModuleService: new BusinessModuleService({
      repo: new SqliteBusinessModuleRepository(database),
      clock,
    }),
    clock,
    invokeSubAgent,
  });
  registerWriteableTools(toolRegistry, {
    projectService,
    businessModuleService: businessModuleServiceForWrites,
    // 阶段 B-sprint13：ReadMarkdownModuleTool 需要
    markdownModuleService: markdownModuleServiceForWrites,
    surveyTaskUseCase: surveyTaskUseCaseForWrites,
    surveyQuestionnaireUseCase: surveyQuestionnaireUseCaseForWrites,
    contactsRepo: projectContactsRepo,
    projectRepo,
    clock,
    logger,
  });

  // Tool registry 包一层 ConfigurableToolRegistry（settings 改 tool config 后会 push 给 tool.configure）
  const configurableToolRegistry = new ConfigurableToolRegistry(toolRegistry, systemSettingsRepo);
  await configurableToolRegistry.refreshAllAsync();

  // ---------- 阶段 7.4h：settings use case ----------
  const settingsUseCase = new SettingsUseCase({
    settings: systemSettingsRepo,
    clock,
    toolRegistry,
    configurableTools: configurableToolRegistry,
    subAgentRegistry,
    llmClientResolver,
    // 阶段 7.7：embedding provider 也接 settings hot-reload
    embeddingProviderResolver: embeddingResolver ?? undefined,
    contextAssembler,
    logger,
  });

  /**
   * 阶段 7.4h：返回当前 default profile 的运行时快照（temperature/maxTokens）。
   * 每次 sub-agent invoke 时都从 DB 读最新值（settings 改完无需重启）。
   * 注意是 sync 调用：use case 内部 cache 了 settings 读取（5s TTL）。
   */
  const profileSnapshot = ():
    | import("@backend/ai/sub-agent/sub-agent-runner.ts").ProfileSnapshot
    | undefined => {
    const snap = settingsUseCase.cachedLLMProfiles();
    if (!snap) return undefined;
    const def = snap.value.profiles.find((p) => p.name === snap.value.defaultProfile);
    if (!def) return undefined;
    return { temperature: def.temperature, maxTokens: def.maxTokens };
  };

  // 阶段 13（PR #5）：builtin skill 用的默认 profile —— 需 model + temperature + maxTokens
  // 同步读 settingsUseCase cache（5s TTL），失败兜底 config.profiles[config.defaultProfile]
  const defaultProfileConfig = ():
    | import("@backend/infrastructure/config/types.ts").ProfileConfig
    | undefined => {
    const snap = settingsUseCase.cachedLLMProfiles();
    if (snap) {
      const def = snap.value.profiles.find((p) => p.name === snap.value.defaultProfile);
      if (def) {
        return {
          provider: def.provider,
          model: def.model,
          temperature: def.temperature,
          maxTokens: def.maxTokens,
          ...(def.baseUrl !== undefined ? { baseUrl: def.baseUrl } : {}),
        };
      }
    }
    return config.profiles[config.defaultProfile];
  };

  // 启动期 priming：让 sync lambda 第一次访问就拿到非空值
  await settingsUseCase.getLLMProfiles();

  // 阶段 7.7：从 settings 取 defaultProfileName 并构造 invokeSubAgent 闭包
  const defaultProfileNameFromSettings =
    settingsUseCase.cachedLLMProfiles()?.value.defaultProfile ??
      "";
  buildInvokeSubAgentClosure(defaultProfileNameFromSettings);
  buildContextAssemblerFromSettings();

  // 阶段 13（PR #9）：auto-mode 全流水线 —— 把 InvokeSubAgentUseCase 包装成 SubAgentRunner 形状，
  // 串 DefaultAutoModeContextProvider + SubAgentAutoModeWorker + 双 SubAgentReviewer + AutoModeOrchestrator，
  // 注入 server "/api/ai/auto-mode" 路由。
  const autoModeContextProvider = new DefaultAutoModeContextProvider({
    projectService,
    markdownModuleService: new MarkdownModuleService({
      businessModuleService: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      clock,
    }),
    structuredModulesUseCase: new StructuredModulesUseCase({
      bm: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
    }),
    surveyQuestionnaireUseCase: new SurveyQuestionnaireUseCase({
      businessModuleService: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      clock,
    }),
    surveyTaskUseCase: new SurveyTaskUseCase({
      businessModuleService: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      clock,
    }),
  });
  const autoModeRunner = asSubAgentRunner(
    new AutoModeRunnerAdapter({
      invokeUseCase: invokeSubAgentUseCase,
      toolRegistry,
    }),
  );
  const autoModeWorker = new SubAgentAutoModeWorker({
    registry: subAgentRegistry,
    runner: autoModeRunner,
    toolRegistry,
  });
  const autoModeCustomerReviewer = makeSubAgentReviewer({
    role: "customer",
    registry: subAgentRegistry,
    runner: autoModeRunner,
    toolRegistry,
  });
  const autoModeDirectorReviewer = makeSubAgentReviewer({
    role: "director",
    registry: subAgentRegistry,
    runner: autoModeRunner,
    toolRegistry,
  });
  const autoModeOrchestrator = new AutoModeOrchestrator({
    worker: autoModeWorker,
    customerReviewer: autoModeCustomerReviewer,
    directorReviewer: autoModeDirectorReviewer,
    contextProvider: autoModeContextProvider,
  });

  // 阶段 7.5：报价 AI 起草回调（H7 修复）—— 调 proposal-drafter sub-agent + 抽干成 markdown
  const aiGenerateMarkdown = async (args: {
    snapshot: import("@backend/domain/quote/quote-snapshot.ts").QuoteSnapshot;
    userInput: string;
    projectCode: string;
    projectName: string;
    clientName: string;
  }): Promise<string> => {
    const budgetSummary = JSON.stringify(args.snapshot.top, null, 2);
    const hardwareList = args.snapshot.hardware.items.map((
      it: { device: string; qty: number; subtotal: number },
    ) => `- ${it.device} ×${it.qty} ¥${it.subtotal}`).join("\n");
    const prompt = `项目编号：${args.projectCode}
项目名称：${args.projectName}
客户名称：${args.clientName}
用户附加说明：${args.userInput}

报价摘要（grand total 不含税）：
${budgetSummary}

硬件清单：
${hardwareList || "（无）"}

请基于以上信息撰写一份面向客户的报价说明 markdown（300~800 字，分「项目概述」「报价构成」「交付与里程碑」「付款条款」4 节）。`;
    try {
      return await collectStreamToString(invokeSubAgent("proposal-drafter", prompt));
    } catch (e) {
      logger.warn("aiGenerateMarkdown failed, returning empty", {
        error: e instanceof Error ? e.message : String(e),
      });
      return "";
    }
  };

  // 阶段 13（PR #5）：构造 SkillRegistry —— 先 default 2 个 demo skill，
  // 再追加 3 个 builtin 业务 skill（status_check / summarize_project / draft_email）
  const skillRegistry: SkillRegistry = buildDefaultSkillRegistry();
  // 共享 chatSessionUseCase 实例（PR #5 builtin skill + chat-session route 同源）
  const chatSessionUseCase = new ChatSessionUseCase({
    repo: new SqliteChatSessionRepository(database),
    clock,
  });
  // 阶段 13（PR #7）：chat 附件 use case —— 复用 chatSessionRepo + llm client
  // 注：llmClient 是 lazy 包装 —— 启动时 resolver 不一定就绪；tryParseSummary 内部 catch
  // 任何错误，AI 解析失败不阻塞 upload。storageDir = dataDir/chat-attachments。
  const chatAttachmentUseCase = new ChatAttachmentUseCase({
    repo: new SqliteChatAttachmentRepository(database),
    chatSessionRepo: new SqliteChatSessionRepository(database),
    llmClient: makeLazyLlmClient(
      llmClientResolver,
      defaultProfileConfig()?.model ?? config.defaultProfile,
    ),
    defaultProfile: defaultProfileConfig() ?? fakeProfile,
    storageDir: `${config.app.dataDir}/chat-attachments`,
    clock,
  });
  {
    const profile = defaultProfileConfig();
    if (profile) {
      try {
        const llmClient = await resolveClient(profile.model ?? config.defaultProfile);
        const builtinBusinessModuleService = new BusinessModuleService({
          repo: new SqliteBusinessModuleRepository(database),
          clock,
        });
        for (
          const s of makeBuiltinSkills({
            llmClient,
            defaultProfile: profile,
            projectService,
            businessModuleService: builtinBusinessModuleService,
            chatSessionUseCase,
            logger,
          })
        ) {
          skillRegistry.register(s);
        }
      } catch (e) {
        logger.warn("skill registry builtin registration skipped", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const app = createApp({
    config,
    logger,
    staticRoot,
    devMode,
    dbProbe: async () => true,
    llmProbe: async () => {
      // 阶段 7.7：从 settings DB 读 profile 列表（settings 才是唯一真相源）
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
      invokeSubAgent, // 阶段 7.5（H5）：让 generatePlaceholder 走真 LLM
      getProjectMeta: async (projectId) => {
        const r = await projectService.getProject(projectId);
        if (!r.ok) return null;
        return { name: r.value.name, clientName: r.value.clientName };
      },
    }),
    surveyTaskUseCase: new SurveyTaskUseCase({
      businessModuleService: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      clock,
      invokeSubAgent,
    }),
    surveyQuestionnaireUseCase: new SurveyQuestionnaireUseCase({
      businessModuleService: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      clock,
      invokeSubAgent, // 阶段 7.5（H6）：让 batchFromMindmap 逐节点真调 LLM
    }),
    markdownModuleService: new MarkdownModuleService({
      businessModuleService: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      clock,
      invokeSubAgent, // 阶段 7.5（H4）：注入后真调 sub-agent
      getProjectMeta: async (projectId) => {
        const r = await projectService.getProject(projectId);
        if (!r.ok) return null;
        return { name: r.value.name, clientName: r.value.clientName };
      },
    }),
    structuredModulesUseCase: new StructuredModulesUseCase({
      bm: new BusinessModuleService({
        repo: new SqliteBusinessModuleRepository(database),
        clock,
      }),
      invokeSubAgent, // 阶段 7.5（H1）：让功能列表 AI 生成真调 LLM
      getProjectMeta: async (projectId: ProjectId) => {
        const r = await projectService.getProject(projectId);
        if (!r.ok) return null;
        return { name: r.value.name, clientName: r.value.clientName };
      },
    }),
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
        settings: systemSettingsRepo,
        smtpFactory: createSmtpTransport,
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
        aiGenerateMarkdown,
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
        aiGenerateMarkdown,
      });
      return { logger, useCase: quoteUseCase, storage: quoteStorage };
    })(),
    // 阶段 7.4g：仪表盘
    dashboardRoute: (() => {
      const useCase = new DashboardUseCase({
        projectRepo,
        businessModuleRepo: new SqliteBusinessModuleRepository(database),
        clock,
      });
      return { logger, useCase };
    })(),
    // 阶段 7.4h：系统设置（4 类）
    settingsRoute: { logger, useCase: settingsUseCase },
    // 阶段 13（PR #4）：chat session —— use case 实例化并注入 server。
    // 路由处理函数 handleChatSession 已存在（chat-session.route.ts），
    // 但 server.ts 在 chatSessionRoute 未注入时返 501；本接线激活该路由。
    chatSessionRoute: {
      logger,
      useCase: chatSessionUseCase,
    },
    // 阶段 13（PR #7）：chat 附件上传/列表路由
    chatAttachmentRoute: {
      logger,
      useCase: chatAttachmentUseCase,
    },
    // 阶段 13（PR #5）：skill 路由（list + invoke）；与 skillRegistry 共享同一实例
    skillRoute: {
      logger,
      registry: skillRegistry,
    },
    // 阶段 13（PR #5）：把 skillRegistry 注入 server；ai.route.ts 的 slash dispatcher 用它
    skillRegistry,
    // 阶段 13（PR #9）：auto-mode 全流水线入口（SubAgentRunner adapter + orchestrator）
    autoModeRoute: {
      logger,
      orchestrator: autoModeOrchestrator,
    },
    // 阶段 7.4h：sub-agent invoke 时读取当前 default profile 快照
    profileSnapshot,
    // 阶段 7.5（H8）：route 改走 use case 单点入口
    invokeSubAgentUseCase,
  });

  return { app, config, logger, paths };
}
