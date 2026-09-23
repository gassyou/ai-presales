/**
 * 应用组合根 —— 装中间件、挂路由、暴露 fetch 给 Deno.serve
 *
 * createApp(deps) 是一次性构造，路由在闭包内通过 deps 拿到所有依赖。
 * 这套设计保证：测试可以构造一个最小 deps 启一个 fake server，无需起真服务。
 */

import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectService } from "@backend/application/project/project.service.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import type { IToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import type { ContextAssembler } from "@backend/ai/context/context-assembler.ts";
import type { IAiSessionRepository } from "@backend/domain/ai-session/ai-session.repository.ts";
import type { MentionResolver } from "@backend/ai/context/providers/mention-resolver.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { requestLogMiddleware } from "./middleware/request-log.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { healthHandler, type HealthDeps } from "./routes/health.route.ts";
import { handleProjects, type ProjectRouteDeps } from "./routes/project.route.ts";
import { handleAiChat, handleAiChatStream, type AiChatRouteDeps } from "./routes/ai.route.ts";
import { handleSubAgents, type SubAgentRouteDeps } from "./routes/sub-agent.route.ts";
import { handleKnowledge, type KnowledgeRouteDeps } from "./routes/knowledge.route.ts";
import {
  handleBusinessModule,
  type BusinessModuleRouteDeps,
} from "./routes/business-module.route.ts";
import {
  handleSurveyQuestionnaire,
  type SurveyQuestionnaireRouteDeps,
} from "./routes/survey-questionnaire.route.ts";
import {
  handleMarkdownModule,
  type MarkdownModuleRouteDeps,
} from "./routes/markdown-module.route.ts";
import {
  handleStructuredModules,
  type StructuredModulesRouteDeps,
} from "./routes/structured-modules.route.ts";
import {
  handleBudget,
  type BudgetRouteDeps,
} from "./routes/budget.route.ts";
import {
  handlePpt,
  type PptRouteDeps,
} from "./routes/ppt.route.ts";
import {
  handleProjectContacts,
  type ProjectContactsRouteDeps,
} from "./routes/project-contacts.route.ts";
import {
  handleEmail,
  type EmailRouteDeps,
} from "./routes/email.route.ts";
import {
  handleHardwareItems,
  type HardwareItemsRouteDeps,
} from "./routes/hardware-items.route.ts";
import {
  handleQuote,
  type QuoteRouteDeps,
} from "./routes/quote.route.ts";
import {
  handleQuoteTemplates,
  type QuoteTemplatesRouteDeps,
} from "./routes/quote-templates.route.ts";
import {
  handleDashboard,
  type DashboardRouteDeps,
} from "./routes/dashboard.route.ts";
import {
  handleSettings,
  type SettingsRouteDeps,
} from "./routes/settings.route.ts";
import type { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import type { MarkdownModuleService } from "@backend/application/business-module/markdown-module.service.ts";

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  /** 静态资源根目录；null 表示不托管静态 */
  staticRoot?: string;
  /** 是否启用开发态 CORS（vite dev server 跨域调用） */
  devMode: boolean;
  /** 健康检查探针 */
  dbProbe?: () => Promise<boolean>;
  llmProbe?: () => Promise<{ ok: boolean; providers: readonly string[] }>;
  /** Project 用例服务；阶段 2 注入 */
  projectService?: ProjectService;
  /** 阶段 3：按 profile 名解析 ILLMClient。阶段 7.7 改为 async（settings DB） */
  clientResolver?: (profileName: string) => Promise<ILLMClient>;
  /** 阶段 5：sub-agent + tool 注册表 */
  subAgentRegistry?: ISubAgentRegistry;
  toolRegistry?: IToolRegistry;
  /** sub-agent invoke 时需要的 cwd / allowedPaths */
  toolCwd?: string;
  toolAllowedPaths?: readonly string[];
  /** 阶段 6.0g：knowledge ingest/status 路由依赖；可选（不传则返回 501） */
  knowledgeRoute?: KnowledgeRouteDeps;
  /** 阶段 6.0g：消息路由需要的 Clock（不传则用 SystemClock） */
  clock?: Clock;
  /** 阶段 6.0e/g：sub-agent 上下文装配器（ContextAssembler） */
  contextAssembler?: ContextAssembler;
  /** 阶段 6.0e/g：AI 会话仓储（用于持久化 sub-agent 调用） */
  sessionRepo?: IAiSessionRepository;
  /** 阶段 6.0g：mention 解析器（让 ContextAssembler 解析 @xxx） */
  mentionResolver?: MentionResolver;
  /** 阶段 7.0：业务模块通用 CRUD 服务（20+ 模块共用） */
  businessModuleService?: BusinessModuleService;
  /** 阶段 7.1：调查任务专用用例（start / stop / batchGenerate） */
  surveyTaskUseCase?: import("@backend/application/business-module/survey-task.usecase.ts").SurveyTaskUseCase;
  /** 阶段 7.2：调查问卷专用用例（大纲脑图 + 问题列表 + 回答保存） */
  surveyQuestionnaireUseCase?: import("@backend/application/business-module/survey-questionnaire.usecase.ts").SurveyQuestionnaireUseCase;
  /** 阶段 7.3：markdown_* 模块统一用例（业务现状/痛点/改善等 11 个） */
  markdownModuleService?: MarkdownModuleService;
  /** 阶段 7.4a：用例 / 交付物 / Review 三个结构化模块统一用例 */
  structuredModulesUseCase?: import("@backend/application/business-module/structured-modules.usecase.ts").StructuredModulesUseCase;
  /** 阶段 7.4c：提案 PPT 设计 */
  pptUseCase?: import("@backend/application/business-module/ppt.usecase.ts").PptUseCase;
  /** 阶段 7.4e：项目联系人 / 团队成员 路由依赖 */
  projectContactsRoute?: ProjectContactsRouteDeps;
  /** 阶段 7.4e：邮件 + 附件 路由依赖 */
  emailRoute?: EmailRouteDeps;
  /** 阶段 7.4f：硬件设备清单 路由依赖 */
  hardwareItemsRoute?: HardwareItemsRouteDeps;
  /** 阶段 7.4f：报价单 路由依赖 */
  quoteRoute?: QuoteRouteDeps;
  /** 阶段 7.4f：报价单 Excel 模板 路由依赖 */
  quoteTemplatesRoute?: QuoteTemplatesRouteDeps;
  /** 阶段 7.4g：仪表盘聚合 路由依赖 */
  dashboardRoute?: DashboardRouteDeps;
  /** 阶段 7.4h：系统设置（4 类）路由依赖 */
  settingsRoute?: SettingsRouteDeps;
  /** 阶段 7.4h：返回当前 default profile 快照（sub-agent invoke 时读 temperature/maxTokens） */
  profileSnapshot?: () => import("@backend/ai/sub-agent/sub-agent-runner.ts").ProfileSnapshot | undefined;
  /** 阶段 7.5（H8）：invoke 改走 InvokeSubAgentUseCase 单点入口；不传则 route 走原 inline 路径 */
  invokeSubAgentUseCase?: import("@backend/application/sub-agent/invoke-sub-agent.usecase.ts").InvokeSubAgentUseCase;
}

export interface App {
  fetch(req: Request): Promise<Response>;
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): App {
  const { config, logger, staticRoot, devMode } = deps;

  const healthDeps: HealthDeps = {
    config,
    dbProbe: deps.dbProbe,
    llmProbe: deps.llmProbe,
  };

  const projectRouteDeps: ProjectRouteDeps | undefined = deps.projectService
    ? { logger, service: deps.projectService }
    : undefined;

  const aiRouteDeps: AiChatRouteDeps | undefined = deps.clientResolver
    ? { logger, config: deps.config, clientResolver: deps.clientResolver }
    : undefined;

  const subAgentRouteDeps: SubAgentRouteDeps | undefined =
    deps.clientResolver && deps.subAgentRegistry && deps.toolRegistry
      ? {
        logger,
        registry: deps.subAgentRegistry,
        toolRegistry: deps.toolRegistry,
        clientResolver: deps.clientResolver,
        cwd: deps.toolCwd ?? Deno.cwd(),
        allowedPaths: deps.toolAllowedPaths ?? [],
        defaultProfileName: deps.config.defaultProfile,
        ...(deps.contextAssembler ? { contextAssembler: deps.contextAssembler } : {}),
        ...(deps.sessionRepo ? { sessionRepo: deps.sessionRepo } : {}),
        ...(deps.mentionResolver ? { mentionResolver: deps.mentionResolver } : {}),
        ...(deps.clock ? { clock: deps.clock } : {}),
        ...(deps.profileSnapshot ? { profileSnapshot: deps.profileSnapshot } : {}),
        ...(deps.invokeSubAgentUseCase ? { invokeSubAgentUseCase: deps.invokeSubAgentUseCase } : {}),
      }
      : undefined;

  // 中间件按洋葱模型从外到内组装
  const withError = errorHandler;
  const withLog = requestLogMiddleware(logger);
  const withCors = corsMiddleware(devMode);

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // API 路由
    if (path.startsWith("/api/")) {
      return await withError(req, () =>
        withCors(req, () =>
          withLog(req, () => routeApi(req, path, url))
        )
      );
    }

    // 静态资源
    if (staticRoot) {
      return await serveStatic(req, path, staticRoot, logger);
    }

    // 无静态 + 无 API 匹配
    return new Response("Not Found", { status: 404 });
  }

  async function routeApi(req: Request, path: string, url: URL): Promise<Response> {
    if (path === "/api/health") {
      return await healthHandler(req, healthDeps);
    }
    if (path === "/api/projects" || path.startsWith("/api/projects/")) {
      // 阶段 7.4e：联系人 / 团队成员必须在 handleProjects 之前拦截，
      // 否则被 projects 通配吃掉。
      if (
        /^\/api\/projects\/[0-9a-fA-F-]{36}\/(contacts|team-members)(\/|$)/.test(path)
      ) {
        if (!deps.projectContactsRoute) {
          return new Response(
            JSON.stringify({ code: "NOT_IMPLEMENTED", message: "contacts service not wired", traceId: "" }),
            { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }
        return await handleProjectContacts(req, deps.projectContactsRoute, url);
      }
      if (/^\/api\/projects\/[0-9a-fA-F-]{36}\/emails(\/|$)/.test(path)) {
        if (!deps.emailRoute) {
          return new Response(
            JSON.stringify({ code: "NOT_IMPLEMENTED", message: "mail service not wired", traceId: "" }),
            { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }
        return await handleEmail(req, deps.emailRoute, url);
      }
      // 阶段 7.4f：硬件设备清单 + 报价单（必须在 handleProjects 之前拦截）
      if (
        /^\/api\/projects\/[0-9a-fA-F-]{36}\/hardware-items(\/|$)/.test(path) ||
        /^\/api\/modules\/hardware-items\/[0-9a-fA-F-]{36}\/?$/.test(path)
      ) {
        if (!deps.hardwareItemsRoute) {
          return new Response(
            JSON.stringify({ code: "NOT_IMPLEMENTED", message: "hardware items service not wired", traceId: "" }),
            { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }
        return await handleHardwareItems(req, deps.hardwareItemsRoute, url);
      }
      if (/^\/api\/projects\/[0-9a-fA-F-]{36}\/quote(\/|$)/.test(path)) {
        if (!deps.quoteRoute) {
          return new Response(
            JSON.stringify({ code: "NOT_IMPLEMENTED", message: "quote service not wired", traceId: "" }),
            { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }
        return await handleQuote(req, deps.quoteRoute, url);
      }
      if (/^\/api\/projects\/[0-9a-fA-F-]{36}\/quote-templates(\/|$)/.test(path)) {
        if (!deps.quoteTemplatesRoute) {
          return new Response(
            JSON.stringify({ code: "NOT_IMPLEMENTED", message: "quote templates service not wired", traceId: "" }),
            { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }
        return await handleQuoteTemplates(req, deps.quoteTemplatesRoute, url);
      }
      if (!projectRouteDeps) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "project service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleProjects(req, projectRouteDeps, url);
    }
    if (path === "/api/ai/chat") {
      if (!aiRouteDeps) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "ai service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleAiChat(req, aiRouteDeps);
    }
    if (path === "/api/ai/chat/stream") {
      if (!aiRouteDeps) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "ai service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleAiChatStream(req, aiRouteDeps);
    }
    if (path === "/api/sub-agents" || path.startsWith("/api/sub-agents/")) {
      if (!subAgentRouteDeps) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "sub-agent registry not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleSubAgents(req, subAgentRouteDeps);
    }
    if (path.includes("/knowledge/")) {
      if (!deps.knowledgeRoute) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "knowledge service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleKnowledge(req, deps.knowledgeRoute, path);
    }
    if (path.includes("/modules/")) {
      if (!deps.businessModuleService) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "business module service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      const bmDeps: BusinessModuleRouteDeps = {
        service: deps.businessModuleService,
        logger,
        ...(deps.surveyTaskUseCase ? { surveyTaskUseCase: deps.surveyTaskUseCase } : {}),
        ...(deps.structuredModulesUseCase ? { structuredModulesUseCase: deps.structuredModulesUseCase } : {}),
      };
      return await handleBusinessModule(req, bmDeps, path);
    }
    if (path.includes("/questionnaire/")) {
      if (!deps.surveyQuestionnaireUseCase) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "survey questionnaire use case not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      const qDeps: SurveyQuestionnaireRouteDeps = {
        useCase: deps.surveyQuestionnaireUseCase,
        logger,
      };
      return await handleSurveyQuestionnaire(req, qDeps, path);
    }
    // markdown_* 模块专用端点：/api/projects/:id/modules/:markdownKind/markdown[/action]
    const markdownPathMatch = /^\/api\/projects\/([^/]+)\/modules\/markdown_[^/]+\/markdown/.test(path);
    if (markdownPathMatch) {
      if (!deps.markdownModuleService) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "markdown module service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      const mDeps: MarkdownModuleRouteDeps = {
        service: deps.markdownModuleService,
        logger,
      };
      return await handleMarkdownModule(req, mDeps, path);
    }
    // 阶段 7.4a：结构化模块（用例 / 交付物 / Review）
    if (
      path.includes("/use-cases") || path.startsWith("/api/use-cases/") ||
      path.includes("/deliverables") || path.startsWith("/api/deliverables/") ||
      path.includes("/reviews")
    ) {
      if (!deps.structuredModulesUseCase) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "structured modules use case not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      const sDeps: StructuredModulesRouteDeps = {
        useCase: deps.structuredModulesUseCase,
        logger,
      };
      return await handleStructuredModules(req, sDeps, path);
    }
    // 阶段 7.4b：预算设置 / 预算汇总
    if (path.includes("/budget-settings") || path.includes("/budget-summary")) {
      if (!deps.structuredModulesUseCase) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "structured modules use case not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      const bDeps: BudgetRouteDeps = {
        useCase: deps.structuredModulesUseCase,
        logger,
      };
      return await handleBudget(req, bDeps, path);
    }
    // 阶段 7.4c：提案 PPT 设计
    if (path.includes("/ppt/pages") || path.includes("/modules/ppt/pages")) {
      if (!deps.pptUseCase || !deps.clientResolver) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "ppt use case not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      const pDeps: PptRouteDeps = {
        useCase: deps.pptUseCase,
        logger,
        config: deps.config,
        clientResolver: deps.clientResolver,
        defaultProfileName: deps.config.defaultProfile,
      };
      return await handlePpt(req, pDeps, path);
    }
    // 阶段 7.4e：项目联系人 / 团队成员（已上移到 /api/projects 分支内部）
    // 阶段 7.4e：邮件 + 附件（已上移到 /api/projects 分支内部）
    // 阶段 7.4f：报价单 Excel 模板（顶层路径）
    if (path === "/api/quote-templates" || /^\/api\/quote-templates\/[0-9a-fA-F-]{36}\/?$/.test(path)) {
      if (!deps.quoteTemplatesRoute) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "quote templates service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleQuoteTemplates(req, deps.quoteTemplatesRoute, url);
    }
    // 阶段 7.4g：仪表盘
    if (path.startsWith("/api/dashboard")) {
      if (!deps.dashboardRoute) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "dashboard service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleDashboard(req, deps.dashboardRoute, url);
    }
    // 阶段 7.4h：系统设置
    if (path === "/api/settings" || path.startsWith("/api/settings/")) {
      if (!deps.settingsRoute) {
        return new Response(
          JSON.stringify({ code: "NOT_IMPLEMENTED", message: "settings service not wired", traceId: "" }),
          { status: 501, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      return await handleSettings(req, deps.settingsRoute, url);
    }
    return new Response(JSON.stringify({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return {
    fetch: handle,
    async close() {
      // 后续阶段挂 database.close()
    },
  };
}

/** 简易静态文件托管：仅用于生产构建产物 */
async function serveStatic(
  req: Request,
  path: string,
  root: string,
  logger?: Logger,
): Promise<Response> {
  // 默认入口
  let rel = path === "/" ? "/index.html" : path;
  // 防 path traversal
  if (rel.includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }

  // 阶段 7.6（macOS 编译版）：用 readFile 一次性读，更容错（macOS 上 Deno.open 偶发挂起）
  try {
    const filePath = `${root}${rel}`;
    const data = await Deno.readFile(filePath);
    const ct = guessContentType(rel);
    return new Response(data, {
      headers: {
        "content-type": ct,
        "content-length": String(data.byteLength),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      // SPA fallback: 所有未匹配的非 API 路径返回 index.html
      try {
        const data = await Deno.readFile(`${root}/index.html`);
        return new Response(data, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch (indexErr) {
        // 阶段 7.6（macOS 编译版启动修复）：index.html 缺失时给清晰错误
        const reason = indexErr instanceof Error ? indexErr.message : String(indexErr);
        const hint =
          `前端入口 ${root}/index.html 不存在或读不开（${reason}）。\n` +
          `请确认：(1) dist/index.html + dist/assets/ 都已就位；\n` +
          `(2) cwd 或可执行文件同目录存在 dist/；\n` +
          `(3) 文件无 macOS quarantine 隔离属性（运行 xattr -d com.apple.quarantine dist/index.html）。\n\n` +
          `API 健康检查请访问 /api/health\n`;
        logger?.warn(`serveStatic 404: ${hint}`);
        return new Response(
          `Not Found\n\n${hint}`,
          { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
        );
      }
    }
    logger?.warn(`serveStatic error: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("Internal Error", { status: 500 });
  }
}

function guessContentType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}