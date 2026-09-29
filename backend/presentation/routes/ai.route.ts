/**
 * /api/ai/chat（同步）
 * /api/ai/chat/stream（SSE 流式）
 *
 * Body (相同):
 *   {
 *     "profile": "fast" | "deep" | "local" | ...,
 *     "systemPrompt"?: string,
 *     "messages": [{ "role": "user" | "assistant" | "system", "content": "..." }, ...]
 *   }
 *
 * 同步响应 (200):
 *   { "content": [...], "stopReason", "usage", "model" }
 *
 * 流式响应 (200, text/event-stream):
 *   data: {"type":"chunk","delta":"...","messageId":"..."}
 *   data: {"type":"done","messageId":"...","usage":{...}}
 *
 * 错误：
 *   401 / 403 → 401 LLM_AUTH_FAILED
 *   429       → 429 LLM_RATE_LIMIT
 *   5xx       → 502 LLM_UPSTREAM_ERROR
 *   缺 profile → 400
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import { ChatUseCase } from "@backend/application/ai/chat.usecase.ts";
import { StreamChatUseCase } from "@backend/application/ai/stream-chat.usecase.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { CanonicalMessage, ToolSpec } from "@backend/ai/message/canonical-message.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import { chatWithToolsLoop, pickToolSpecs } from "@backend/ai/chat/chat-with-tools-loop.ts";
import { LlmError } from "@backend/ai/transport.ts";
import { ErrorCode, type ErrorEnvelope } from "@shared/types/common.ts";
import { buildSseResponse } from "../sse/sse-writer.ts";
import type { SkillRegistry } from "@backend/ai/skill/skill.ts";
import { parseSlashCommand } from "@backend/ai/chat/slash-command.ts";

export interface AiChatRouteDeps {
  logger: Logger;
  config: AppConfig;
  clientResolver: (profileName: string) => Promise<ILLMClient>;
  /** 阶段 H：可选的 tool registry（带 writeableTools 已注册）。chat 启用 tools 时用。 */
  toolRegistry?: import("@backend/ai/tool/tool-registry.ts").IToolRegistry;
  /** tool loop 需要的 cwd / allowedPaths（可选；不传则用空值） */
  toolCwd?: string;
  toolAllowedPaths?: readonly string[];
  /** 阶段 13（PR #5）：可选 skill registry；启用后会在 chat 入口拦截 /skill 命令 */
  skillRegistry?: SkillRegistry;
}

interface AiChatRequestBody {
  profile?: string;
  systemPrompt?: string;
  messages?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  /**
   * 阶段 H：启用一组工具名（来自 ToolRegistry.names()）。带 tools 的请求走 agent loop，
   * 解析 tool_use 并自动执行；前端 SSE 收到 tool_call / tool_result 事件。
   */
  toolNames?: readonly string[];
  /**
   * 阶段 H+2：force 决策一组 tool 名（一次性，仅本次请求生效）。
   * - approveNames：忽略 requiresApproval 检查，真执行
   * - rejectNames：返 USER_REJECTED（不真执行）
   * 一次性 force（不像 token 那样粘在 toolCallId 上）是因为 LLM 重试时通常换
   * toolCallId，所以前端按 tool 名决策最稳。
   */
  forceApproveNames?: readonly string[];
  forceRejectNames?: readonly string[];
  /**
   * 阶段 13（PR #8）：会话级"全部自动批准"开关。true → 等价于把所有 tool 名
   * 加入 forceApproveNames（一次请求内仍尊重 forceRejectNames）。
   */
  autoApprove?: boolean;
}

type ParsedBody =
  | {
    ok: true;
    profileName: string;
    profile: ProfileConfig;
    messages: CanonicalMessage[];
    systemPrompt?: string;
    toolNames?: readonly string[];
    forceApproveNames?: readonly string[];
    forceRejectNames?: readonly string[];
    autoApprove?: boolean;
  }
  | { ok: false; response: Response };

function err(status: number, code: string, message: string): Response {
  const body: ErrorEnvelope = { code, message, traceId: "" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * 阶段 13（PR #5）：slash dispatcher —— 拦截首条 user message 中的 /skill 命令
 *
 * 命中后：跳过 LLM，直接把 skill 输出作为 assistant 文本返给前端。
 * 行为契约：
 *   - 非 /skill 命令 → 返 null（让调用方继续走 LLM）
 *   - /skill 且 skill 不存在 → 返 404 err Response
 *   - /skill 执行失败 → 返 500 err Response
 *   - 成功 → 返一个 fake "assistant" 文本（不会再被 LLM 处理）
 */
async function dispatchSlashCommand(
  messages: readonly CanonicalMessage[],
  deps: AiChatRouteDeps,
): Promise<null | Response> {
  if (!deps.skillRegistry) return null;
  // 取最后一条 user 消息
  let lastUserText: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      const first = m.content[0];
      lastUserText = first && first.type === "text" ? first.text : undefined;
      break;
    }
  }
  if (typeof lastUserText !== "string" || !lastUserText.trim().startsWith("/")) return null;

  const parsed = parseSlashCommand(lastUserText);
  if (parsed.command.type !== "skill") return null;

  const skillName = parsed.command.arg;
  const skill = deps.skillRegistry.get(skillName);
  if (!skill) {
    return err(404, ErrorCode.NOT_FOUND, `skill not found: ${skillName}`);
  }

  let args: unknown = {};
  if (parsed.command.extra) {
    try {
      args = JSON.parse(parsed.command.extra);
    } catch {
      args = { message: parsed.command.extra };
    }
  }

  try {
    const output = await skill.execute(args, {
      logger: deps.logger,
      cwd: deps.toolCwd ?? Deno.cwd(),
      allowedPaths: deps.toolAllowedPaths ?? [],
      timeoutMs: 30_000,
      signal: undefined,
    });
    const text = typeof output === "string" ? output : JSON.stringify(output);
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        stopReason: "skill_dispatch",
        skillName,
      }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (e) {
    deps.logger.warn(`skill ${skillName} dispatch failed`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return err(
      500,
      ErrorCode.INTERNAL,
      `skill ${skillName} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function parseRequest(
  raw: unknown,
  config: AppConfig,
): ParsedBody {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      response: err(400, ErrorCode.VALIDATION_FAILED, "expected JSON object body"),
    };
  }
  const body = raw as AiChatRequestBody;
  if (typeof body.profile !== "string") {
    return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, "profile is required") };
  }
  const profile = config.profiles[body.profile];
  if (!profile) {
    return {
      ok: false,
      response: err(400, ErrorCode.VALIDATION_FAILED, `unknown profile: ${body.profile}`),
    };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      ok: false,
      response: err(400, ErrorCode.VALIDATION_FAILED, "messages is required and must be non-empty"),
    };
  }
  const canonical: CanonicalMessage[] = [];
  for (const m of body.messages) {
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") {
      return {
        ok: false,
        response: err(400, ErrorCode.VALIDATION_FAILED, `invalid role: ${String(m.role)}`),
      };
    }
    if (typeof m.content !== "string") {
      return {
        ok: false,
        response: err(400, ErrorCode.VALIDATION_FAILED, "content must be a string"),
      };
    }
    canonical.push({ role: m.role, content: [{ type: "text", text: m.content }] });
  }
  const result: {
    ok: true;
    profileName: string;
    profile: ProfileConfig;
    messages: CanonicalMessage[];
    systemPrompt?: string;
    toolNames?: readonly string[];
    forceApproveNames?: readonly string[];
    forceRejectNames?: readonly string[];
    autoApprove?: boolean;
  } = {
    ok: true,
    profileName: body.profile,
    profile,
    messages: canonical,
  };
  if (body.systemPrompt !== undefined) result.systemPrompt = body.systemPrompt;
  if (body.toolNames !== undefined) result.toolNames = body.toolNames;
  if (body.forceApproveNames !== undefined) {
    if (
      !Array.isArray(body.forceApproveNames) ||
      body.forceApproveNames.some((n) => typeof n !== "string")
    ) {
      return {
        ok: false,
        response: err(400, ErrorCode.VALIDATION_FAILED, "forceApproveNames must be string[]"),
      };
    }
    result.forceApproveNames = body.forceApproveNames;
  }
  if (body.forceRejectNames !== undefined) {
    if (
      !Array.isArray(body.forceRejectNames) ||
      body.forceRejectNames.some((n) => typeof n !== "string")
    ) {
      return {
        ok: false,
        response: err(400, ErrorCode.VALIDATION_FAILED, "forceRejectNames must be string[]"),
      };
    }
    result.forceRejectNames = body.forceRejectNames;
  }
  // 阶段 13（PR #8）：autoApprove 布尔开关
  if (body.autoApprove !== undefined) {
    if (typeof body.autoApprove !== "boolean") {
      return {
        ok: false,
        response: err(400, ErrorCode.VALIDATION_FAILED, "autoApprove must be boolean"),
      };
    }
    result.autoApprove = body.autoApprove;
  }
  return result;
}

export async function handleAiChat(req: Request, deps: AiChatRouteDeps): Promise<Response> {
  if (req.method !== "POST") {
    return err(405, ErrorCode.INTERNAL, `method ${req.method} not allowed`);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, ErrorCode.VALIDATION_FAILED, "invalid JSON body");
  }
  const parsed = parseRequest(raw, deps.config);
  if (!parsed.ok) return parsed.response;

  // 阶段 13（PR #5）：slash dispatcher —— /skill 命令优先于 LLM
  const slashed = await dispatchSlashCommand(parsed.messages, deps);
  if (slashed !== null) return slashed;

  let client: ILLMClient;
  try {
    client = await deps.clientResolver(parsed.profileName);
  } catch (e) {
    deps.logger.warn("client resolver failed", {
      profile: parsed.profileName,
      message: e instanceof Error ? e.message : String(e),
    });
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "no client");
  }

  const usecase = new ChatUseCase(client);
  try {
    const r = await usecase.execute({
      profile: parsed.profile,
      messages: parsed.messages,
      ...(parsed.systemPrompt !== undefined ? { systemPrompt: parsed.systemPrompt } : {}),
      signal: req.signal,
    });
    return new Response(
      JSON.stringify({
        content: r.message.content,
        stopReason: r.message.stopReason,
        usage: r.message.usage,
        model: r.message.model,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  } catch (e) {
    return mapLlmError(e, deps.logger);
  }
}

export async function handleAiChatStream(req: Request, deps: AiChatRouteDeps): Promise<Response> {
  if (req.method !== "POST") {
    return err(405, ErrorCode.INTERNAL, `method ${req.method} not allowed`);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, ErrorCode.VALIDATION_FAILED, "invalid JSON body");
  }
  const parsed = parseRequest(raw, deps.config);
  if (!parsed.ok) return parsed.response;

  // 阶段 13（PR #5）：slash dispatcher —— /skill 命令优先于 LLM
  const slashed = await dispatchSlashCommand(parsed.messages, deps);
  if (slashed !== null) return slashed;

  let client: ILLMClient;
  try {
    client = await deps.clientResolver(parsed.profileName);
  } catch (e) {
    deps.logger.warn("client resolver failed (stream)", {
      profile: parsed.profileName,
      message: e instanceof Error ? e.message : String(e),
    });
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "no client");
  }

  // 阶段 H：带 toolNames → agent loop；否则原 StreamChatUseCase
  if (parsed.toolNames && parsed.toolNames.length > 0) {
    if (!deps.toolRegistry) {
      return err(503, ErrorCode.INTERNAL, "tool registry not wired for this chat route");
    }
    const toolSpecs = pickToolSpecs(deps.toolRegistry, parsed.toolNames);
    if (toolSpecs.length === 0) {
      return err(
        400,
        ErrorCode.VALIDATION_FAILED,
        `none of toolNames found in registry: ${parsed.toolNames.join(",")}`,
      );
    }
    const executor = new ToolExecutor({
      registry: deps.toolRegistry,
      logger: deps.logger,
      cwd: deps.toolCwd ?? Deno.cwd(),
      allowedPaths: deps.toolAllowedPaths ?? [],
      defaultTimeoutMs: 30_000,
      ...(parsed.forceApproveNames !== undefined
        ? { forceApproveNames: parsed.forceApproveNames }
        : {}),
      ...(parsed.forceRejectNames !== undefined
        ? { forceRejectNames: parsed.forceRejectNames }
        : {}),
      // 阶段 13（PR #8）：autoApprove 开关
      ...(parsed.autoApprove === true ? { forceApproveAll: true } : {}),
    });

    const stream = chatWithToolsLoop({
      client,
      profile: parsed.profile,
      messages: parsed.messages,
      ...(parsed.systemPrompt !== undefined ? { systemPrompt: parsed.systemPrompt } : {}),
      tools: toolSpecs,
      executor,
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
      logger: deps.logger,
    });

    return buildSseResponse(stream, req.signal, {
      logger: {
        warn: (msg, meta) => deps.logger.warn(msg, meta ?? {}),
      },
    });
  }

  const usecase = new StreamChatUseCase(client);
  const stream = usecase.execute({
    profile: parsed.profile,
    messages: parsed.messages,
    ...(parsed.systemPrompt !== undefined ? { systemPrompt: parsed.systemPrompt } : {}),
    signal: req.signal,
  });

  return buildSseResponse(stream, req.signal, {
    logger: {
      warn: (msg, meta) => deps.logger.warn(msg, meta ?? {}),
    },
  });
}

function mapLlmError(e: unknown, logger: Logger): Response {
  if (e instanceof LlmError) {
    const map: Record<string, { status: number; code: string }> = {
      LLM_AUTH_FAILED: { status: 401, code: ErrorCode.LLM_AUTH_FAILED },
      LLM_RATE_LIMIT: { status: 429, code: ErrorCode.LLM_RATE_LIMIT },
      LLM_UPSTREAM_ERROR: { status: 502, code: ErrorCode.LLM_UPSTREAM_ERROR },
      LLM_BAD_REQUEST: { status: 400, code: ErrorCode.VALIDATION_FAILED },
      LLM_CONTEXT_OVERFLOW: { status: 413, code: ErrorCode.LLM_CONTEXT_OVERFLOW },
      LLM_INTERNAL: { status: 500, code: ErrorCode.INTERNAL },
    };
    const m = map[e.code] ?? { status: 500, code: ErrorCode.INTERNAL };
    logger.warn("LLM call failed", { code: e.code, message: e.message, retryable: e.retryable });
    return err(m.status, m.code, e.message);
  }
  logger.error("ai chat unexpected error", { error: e instanceof Error ? e.message : String(e) });
  return err(500, ErrorCode.INTERNAL, "internal error");
}
