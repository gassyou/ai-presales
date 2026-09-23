/**
 * /api/sub-agents
 *   GET  /api/sub-agents                       → list
 *   POST /api/sub-agents/:name/invoke          → SSE stream
 *
 * invoke 路由复用阶段 4 的 buildSseResponse。
 * 阶段 6.0e 起：invoke 走 ContextAwareSubAgentRunner，自动装配上下文 + 持久化 session。
 * 阶段 6.0g：route 层注入 MentionResolver（让 ContextAssembler 解析 @xxx）。
 * 阶段 7.5（H8 修复）：若 deps.invokeSubAgentUseCase 提供则走 use case；否则走原 inline 路径（dev/测试）。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { IToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import type { ToolInvocation } from "@backend/ai/tool/tool.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { ToolCallId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import { buildSseResponse } from "../sse/sse-writer.ts";
import { ErrorCode, type ErrorEnvelope } from "@shared/types/common.ts";
import { ContextAwareSubAgentRunner } from "@backend/ai/sub-agent/context-aware-runner.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import { MentionResolver } from "@backend/ai/context/providers/mention-resolver.ts";
import type { ContextAssembler } from "@backend/ai/context/context-assembler.ts";
import type { IAiSessionRepository } from "@backend/domain/ai-session/ai-session.repository.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import { ListSubAgentsUseCase } from "@backend/application/sub-agent/list-sub-agents.usecase.ts";
import type { InvokeSubAgentUseCase } from "@backend/application/sub-agent/invoke-sub-agent.usecase.ts";

export interface SubAgentRouteDeps {
  logger: Logger;
  registry: ISubAgentRegistry;
  toolRegistry: IToolRegistry;
  /** profile → ILLMClient */
  clientResolver: (profileName: string) => Promise<ILLMClient>;
  cwd: string;
  allowedPaths: readonly string[];
  defaultProfileName: string;
  /** 阶段 6.0e：上下文装配器；不传则不装配 */
  contextAssembler?: ContextAssembler;
  /** 阶段 6.0e：会话仓储；不传则不持久化 */
  sessionRepo?: IAiSessionRepository;
  /** 阶段 6.0e/g：mention 解析器（让 ContextAssembler 解析 @xxx） */
  mentionResolver?: MentionResolver;
  /** 阶段 6.0e：时钟 */
  clock?: Clock;
  /**
   * 阶段 7.4h：返回当前 default profile 的运行时快照（temperature / maxTokens）。
   * 不传则 runner 用 fallback 默认值。
   */
  profileSnapshot?: () => import("@backend/ai/sub-agent/sub-agent-runner.ts").ProfileSnapshot | undefined;
  /**
   * 阶段 7.5（H8）：invoke 改走 InvokeSubAgentUseCase。提供则用 use case 单点入口；
   * 不提供则保留原 inline ContextAwareSubAgentRunner 路径（dev/测试）。
   */
  invokeSubAgentUseCase?: InvokeSubAgentUseCase;
}

import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { CanonicalMessage, ToolSpec } from "@backend/ai/message/canonical-message.ts";

function err(status: number, code: string, message: string): Response {
  const body: ErrorEnvelope = { code, message, traceId: "" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleSubAgents(req: Request, deps: SubAgentRouteDeps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/api/sub-agents" && req.method === "GET") {
    return listSubAgents(deps);
  }
  // /api/sub-agents/:name/invoke
  const m = path.match(/^\/api\/sub-agents\/([a-z][a-z0-9_-]{2,63})\/invoke$/);
  if (m && req.method === "POST") {
    return invokeSubAgent(req, deps, m[1], url);
  }
  return err(405, ErrorCode.INTERNAL, `unsupported ${req.method} ${path}`);
}

function listSubAgents(deps: SubAgentRouteDeps): Response {
  const uc = new ListSubAgentsUseCase(deps.registry);
  return new Response(JSON.stringify({ items: uc.execute() }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function invokeSubAgent(
  req: Request,
  deps: SubAgentRouteDeps,
  name: string,
  _url: URL,
): Promise<Response> {
  if (!deps.registry.has(name)) {
    return err(404, ErrorCode.NOT_FOUND, `sub-agent not found: ${name}`);
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, ErrorCode.VALIDATION_FAILED, "invalid JSON body");
  }
  if (!raw || typeof raw !== "object") {
    return err(400, ErrorCode.VALIDATION_FAILED, "expected JSON object body");
  }
  const body = raw as {
    input?: string;
    profileName?: string;
    projectId?: string;
    history?: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string;
    }>;
  };
  if (typeof body.input !== "string" || body.input.trim().length === 0) {
    return err(400, ErrorCode.VALIDATION_FAILED, "input is required");
  }

  const spec = deps.registry.get(name);
  if (!spec) {
    return err(404, ErrorCode.NOT_FOUND, `sub-agent not found: ${name}`);
  }

  // 解析 spec.toolNames → ToolSpec[]
  const tools: ToolSpec[] = [];
  for (const toolName of spec.toolNames) {
    const t = deps.toolRegistry.get(toolName);
    if (!t) {
      return err(500, ErrorCode.INTERNAL, `sub-agent references unknown tool: ${toolName}`);
    }
    tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
  }

  const history: CanonicalMessage[] = (body.history ?? []).map((h) => ({
    role: h.role,
    content: [{ type: "text", text: h.content }],
  }));

  const projectId = typeof body.projectId === "string" && body.projectId.length > 0
    ? toProjectId(body.projectId)
    : null;

  // 阶段 7.5（H8）：用 InvokeSubAgentUseCase 单点入口；缺失时回退到原 inline 路径
  let stream: AsyncIterable<StreamEvent>;
  if (deps.invokeSubAgentUseCase) {
    // 阶段 7.7：execute 现在返回 Promise<AsyncIterable>，需 await
    stream = await deps.invokeSubAgentUseCase.execute({
      subAgentName: name,
      userInput: body.input,
      ...(body.profileName ? { profileName: body.profileName } : {}),
      tools,
      ...(history.length > 0 ? { history } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
      // projectId 由 InvokeSubAgentUseCase 内部透传给 ContextAwareSubAgentRunner（项目阶段 7.6 增强）
      ...(projectId !== null ? { projectId: projectId as unknown as string } : {}),
    });
  } else {
    // 原 inline 路径（dev.ts / 集成测试 / 老调用方）
    const profileName = body.profileName ?? spec.profileHint ?? deps.defaultProfileName;
    const client = await deps.clientResolver(profileName);
    const executor = new ToolExecutor({
      registry: deps.toolRegistry,
      logger: deps.logger,
      cwd: deps.cwd,
      allowedPaths: deps.allowedPaths,
    });
    let assembler = deps.contextAssembler;
    if (assembler && deps.mentionResolver) {
      const realLookup = deps.mentionResolver.asProjectLookup();
      const originalAssemble = assembler.assemble.bind(assembler);
      assembler = {
        ...assembler,
        assemble(input: Parameters<typeof originalAssemble>[0]) {
          return originalAssemble({ ...input, projectLookup: realLookup });
        },
      } as unknown as ContextAssembler;
    }
    const runner = new ContextAwareSubAgentRunner({
      client,
      executor,
      ...(assembler ? { assembler } : {}),
      ...(deps.sessionRepo ? { sessionRepo: deps.sessionRepo } : {}),
      ...(deps.clock ? { clock: deps.clock } : { clock: { now: () => new Date() } }),
      ...(projectId !== null ? { projectId } : {}),
      sessionTitle: spec.displayName,
      ...(deps.profileSnapshot ? { profileSnapshot: deps.profileSnapshot } : {}),
    });
    stream = runner.run({
      spec,
      userInput: body.input,
      ...(history.length > 0 ? { history } : {}),
      tools,
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }

  return buildSseResponse(stream, req.signal, {
    logger: { warn: (m, meta) => deps.logger.warn(m, meta ?? {}) },
  });
}

// keep tool imports referenced (otherwise unused)
void ({} as ToolInvocation);
void ToolCallId;