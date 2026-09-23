/**
 * 应用入口（同时支持浏览器调试 + deno desktop 双模式）
 *
 * 关键差异：
 *   - 在 `deno desktop` 下，端口由 desktop 运行时自动选择并通过
 *     `DENO_SERVE_ADDRESS`（形如 `tcp:127.0.0.1:<port>`）注入；用户传的 port 会被忽略。
 *     此时没有 webview 自启动，需主动 `new Deno.BrowserWindow()` + `navigate(...)`。
 *   - 在 `deno run -A main.ts` 下，用内存默认端口（或 AI_PRESALES_CONFIG 指向的 TOML 里的 port）起 server；浏览器调试。
 *
 * 自动识别：通过 `DENO_SERVE_ADDRESS` 是否存在判断。
 */

import { loadConfig } from "@backend/infrastructure/config/config.loader.ts";
import { createLogger } from "@backend/infrastructure/logging/logger.ts";
import { createApp } from "@backend/presentation/server.ts";
import { dirname, join } from "@std/path";
import { ensureDir } from "@backend/infrastructure/platform/paths.ts";
import { resolvePaths } from "@backend/infrastructure/platform/paths.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SdkTransport } from "@backend/ai/transport.sdk.ts";
import { createLlmClient } from "@backend/ai/client/client.factory.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import { buildBuiltinToolRegistry } from "@backend/ai/tool/builtin-tools.ts";
import { buildBuiltinSubAgentRegistry } from "@backend/application/sub-agent/builtin-sub-agents.ts";
import { InvokeSubAgentUseCase } from "@backend/application/sub-agent/invoke-sub-agent.usecase.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";
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
import { EmbeddingUnavailableError } from "@backend/ai/embedding/embedding-provider.ts";
import { EmbeddingProviderResolver } from "@backend/application/settings/embedding-resolver.ts";
import { EmbeddingConfigSetting } from "@backend/domain/settings/embedding-config.setting.ts";
import { SETTING_KEYS as SETTING_KEYS_ } from "@backend/domain/settings/system-setting.repository.ts";
import { DEFAULT_LLM_PROFILES } from "@backend/domain/settings/default-llm-profiles.ts";
const SETTING_KEYS_LLM_PROFILES = SETTING_KEYS_.LLM_PROFILES;
const SETTING_KEYS_EMBEDDING = SETTING_KEYS_.EMBEDDING;
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

const config = await loadConfig();
const logger = createLogger({ level: config.logging.level, context: { component: "main" } });

const paths = resolvePaths();
await ensureDir(paths.data);
await ensureDir(paths.logs);
await ensureDir(paths.vendor);

/**
 * 阶段 7.6（macOS 编译版启动修复）：dist 查找顺序
 *   1. cwd/dist（开发态 `deno task start` 或用户在 dist 同级启动）
 *   2. 可执行文件同级的 dist（编译产物 + 同目录 dist/ 的标准发行方式）
 *   3. cwd/dist 仍作 fallback，static handler 在缺文件时返 404
 *
 * 重要：编译后的产物若 dist/ 与可执行文件不在同一目录，必须用 cwd 启动。
 */
function resolveDistRoot(): string {
  const cwd = Deno.cwd();
  // 0. cwd 本身直接就是 dist（用户 `cd dist` 后启动 binary）——直接用 cwd
  if (looksLikeDistRoot(cwd)) return cwd;

  // 1. cwd/dist（开发态 `deno task start` 或用户在 dist 同级启动）
  const cwdDist = join(cwd, "dist");
  if (looksLikeDistRoot(cwdDist)) return cwdDist;

  // 2. 可执行文件同级 dist（编译产物 + 同目录 dist/ 的标准发行方式）
  try {
    const exeDir = dirname(Deno.execPath());
    const exeDist = join(exeDir, "dist");
    if (looksLikeDistRoot(exeDist)) return exeDist;
    // exeDir 本身就是 dist（用户在 dist 目录里直接启动 binary，没有再嵌套一层）
    if (looksLikeDistRoot(exeDir)) return exeDir;
  } catch (_) { /* not found */ }
  // 最终回退：cwd/dist（即便不存在也返回，静态服务会兜底）
  return cwdDist;
}

/** 判断路径是否就是"dist 根"——含 index.html */
function looksLikeDistRoot(p: string): boolean {
  try {
    const s = Deno.statSync(p);
    if (!s.isDirectory) return false;
    // 含 index.html 就是 dist 根
    Deno.statSync(join(p, "index.html"));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 阶段 7.6：启动期把 dist 目录内容列出来，便于排查"dist 不全"问题
 */
function debugDistContents(root: string): void {
  try {
    const entries: string[] = [];
    for (const e of Deno.readDirSync(root)) {
      entries.push(e.isDirectory ? `${e.name}/` : e.name);
    }
    logger.info(`dist contents (${root}): [${entries.sort().join(", ")}]`);
    // 检测"dist 不全"信号：常见有 binary 但缺 index.html 或 assets/
    const names = new Set(entries.map((s) => s.replace(/\/$/, "")));
    if (!names.has("index.html")) {
      logger.error(`❌ dist 缺少 index.html！当前 dist 内容：[${entries.join(", ")}]`);
      logger.error(`   如果你看到的是嵌套结构（比如 binary 在 dist/dist/），需要清理后重新解压。`);
    }
    if (!names.has("assets")) {
      logger.error(`❌ dist 缺少 assets/ 目录！`);
    }
  } catch (e) {
    logger.warn(`cannot read dist ${root}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const distRoot = resolveDistRoot();

const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;

logger.info("starting app", {
  mode: isDesktopMode ? "deno-desktop" : "deno-run",
  dataDir: config.app.dataDir,
  distRoot,
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
// 延迟到 settings repo 创建之后再 prime。
let embeddingResolver: EmbeddingProviderResolver | null = null;
function buildEmbeddingResolver(): EmbeddingProviderResolver {
  return new EmbeddingProviderResolver(async () => {
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
}

// systemSettingsRepo 已在 line 175 创建；现在就可以 prime embeddingResolver
embeddingResolver = buildEmbeddingResolver();
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
// systemSettingsRepo 已在 line 175 创建（提前到 embeddingResolver prime 之前）。

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
const seedSpecsData = { specs: Object.fromEntries(getBuiltinSubAgentSpecs().map((s) => [s.name, s])) };
await systemSettingsRepo.seedIfEmpty("agents.specs" as import("@backend/domain/settings/system-setting.repository.ts").SystemSettingKey, seedSpecsData, clock);

// embeddingResolver 已在 phase 6.0 装配区创建并 prime（提前以供 retrieveUseCase 使用）

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
        let inner: AsyncIterator<import("@backend/ai/message/canonical-message.ts").StreamEvent> | null = null;
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
const profileSnapshot = (): import("@backend/ai/sub-agent/sub-agent-runner.ts").ProfileSnapshot | undefined => {
  const snap = settingsUseCase.cachedLLMProfiles();
  if (!snap) return undefined;
  const def = snap.value.profiles.find((p) => p.name === snap.value.defaultProfile);
  if (!def) return undefined;
  return { temperature: def.temperature, maxTokens: def.maxTokens };
};

// 启动期 priming：让 sync lambda 第一次访问就拿到非空值
await settingsUseCase.getLLMProfiles();

// 阶段 7.7：从 settings 取 defaultProfileName 并构造 invokeSubAgent 闭包
const defaultProfileNameFromSettings = settingsUseCase.cachedLLMProfiles()?.value.defaultProfile ?? "";
buildInvokeSubAgentClosure(defaultProfileNameFromSettings);
buildContextAssemblerFromSettings();

// 阶段 7.5：报价 AI 起草回调（H7 修复）—— 调 proposal-drafter sub-agent + 抽干成 markdown
const aiGenerateMarkdown = async (args: {
  snapshot: import("./backend/application/quote/quote.usecase.ts").QuoteSnapshot;
  userInput: string;
  projectCode: string;
  projectName: string;
  clientName: string;
}): Promise<string> => {
  const budgetSummary = JSON.stringify(args.snapshot.top, null, 2);
  const hardwareList = args.snapshot.hardware.items.map((it: { name: string; quantity: number; amount: number }) =>
    `- ${it.name} ×${it.quantity} ¥${it.amount}`
  ).join("\n");
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

// 给 builtin sub-agents 加上 read_module（默认不挂，让用户配；project-creator/survey-researcher/proposal-drafter 后续可挂）
// 这里先不动 builtins（避免破坏它们的契约测试），让 read_module 可通过 toolRegistry.get('read_module') 单独选用

// 根据模式决定 serve 配置
const app = createApp({
  config,
  logger,
  staticRoot: distRoot,
  devMode: false,
  dbProbe: async () => true,
  llmProbe: async () => ({ ok: true, providers: Object.keys(config.profiles) }),
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
    getProjectMeta: async (projectId) => {
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
  // 阶段 7.4h：sub-agent invoke 时读取当前 default profile 快照
  profileSnapshot,
  // 阶段 7.5（H8）：route 改走 use case 单点入口
  invokeSubAgentUseCase,
});

const server = isDesktopMode
  // desktop 模式：不传 options，让 Deno.serve 读 DENO_SERVE_ADDRESS
  ? Deno.serve(app.fetch)
  : Deno.serve(
    {
      hostname: config.server.host,
      port: config.server.port,
      onListen: ({ hostname, port }: { hostname: string; port: number }) => {
        logger.info(`listening on http://${hostname}:${port}`);
        logger.info(`serving frontend from ${distRoot}`);
        logger.info(`open http://localhost:${port}/ in your browser`);
        debugDistContents(distRoot);
        // 阶段 7.6（macOS 编译版启动修复）：dist 不存在时给清晰提示
        try {
          Deno.statSync(`${distRoot}/index.html`);
        } catch {
          logger.warn(`⚠️  ${distRoot}/index.html 不存在！`);
          logger.warn(`   请把前端构建产物（dist/index.html + dist/assets/）放到该目录下，`);
          logger.warn(`   或者把可执行文件移动到与 dist/ 同一目录再启动。`);
          logger.warn(`   现在请求根路径会返 404。`);
        }
      },
    },
    app.fetch,
  );

// 仅 desktop 模式需要 BrowserWindow
if (isDesktopMode) {
  // desktop 模式：先 ensure server 已 ready（onListen 不再触发，因为没传 onListen）
  // 第一个 BrowserWindow 会 adopt 隐式启动窗口，需要 navigate 到本地 server
  const port = Deno.env.get("DENO_SERVE_ADDRESS")!.split(":").pop();
  // Deno.BrowserWindow 由 desktop 运行时注入；ambient 类型见 shared/types/deno-desktop.d.ts
  const BrowserWindow = (Deno as unknown as {
    BrowserWindow: new (opts?: unknown) => {
      navigate(url: string): void;
    };
  }).BrowserWindow;
  const win = new BrowserWindow({
    title: "AI 提案协助",
    width: 1280,
    height: 800,
  });
  win.navigate(`http://127.0.0.1:${port}/`);
  logger.info(`desktop window opened on http://127.0.0.1:${port}/`);
}

await server.finished;