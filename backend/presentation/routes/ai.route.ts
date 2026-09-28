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

export interface AiChatRouteDeps {
  logger: Logger;
  config: AppConfig;
  clientResolver: (profileName: string) => Promise<ILLMClient>;
  /** 阶段 H：可选的 tool registry（带 writeableTools 已注册）。chat 启用 tools 时用。 */
  toolRegistry?: import("@backend/ai/tool/tool-registry.ts").IToolRegistry;
  /** tool loop 需要的 cwd / allowedPaths（可选；不传则用空值） */
  toolCwd?: string;
  toolAllowedPaths?: readonly string[];
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
}

type ParsedBody =
  | { ok: true; profileName: string; profile: ProfileConfig; messages: CanonicalMessage[]; systemPrompt?: string; toolNames?: readonly string[] }
  | { ok: false; response: Response };

function err(status: number, code: string, message: string): Response {
  const body: ErrorEnvelope = { code, message, traceId: "" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseRequest(
  raw: unknown,
  config: AppConfig,
): ParsedBody {
  if (!raw || typeof raw !== "object") {
    return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, "expected JSON object body") };
  }
  const body = raw as AiChatRequestBody;
  if (typeof body.profile !== "string") {
    return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, "profile is required") };
  }
  const profile = config.profiles[body.profile];
  if (!profile) {
    return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, `unknown profile: ${body.profile}`) };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, "messages is required and must be non-empty") };
  }
  const canonical: CanonicalMessage[] = [];
  for (const m of body.messages) {
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") {
      return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, `invalid role: ${String(m.role)}`) };
    }
    if (typeof m.content !== "string") {
      return { ok: false, response: err(400, ErrorCode.VALIDATION_FAILED, "content must be a string") };
    }
    canonical.push({ role: m.role, content: [{ type: "text", text: m.content }] });
  }
  const result: { ok: true; profileName: string; profile: ProfileConfig; messages: CanonicalMessage[]; systemPrompt?: string; toolNames?: readonly string[] } = {
    ok: true,
    profileName: body.profile,
    profile,
    messages: canonical,
  };
  if (body.systemPrompt !== undefined) result.systemPrompt = body.systemPrompt;
  if (body.toolNames !== undefined) result.toolNames = body.toolNames;
  return result;
}

export async function handleAiChat(req: Request, deps: AiChatRouteDeps): Promise<Response> {
  if (req.method !== "POST") return err(405, ErrorCode.INTERNAL, `method ${req.method} not allowed`);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, ErrorCode.VALIDATION_FAILED, "invalid JSON body");
  }
  const parsed = parseRequest(raw, deps.config);
  if (!parsed.ok) return parsed.response;

  let client: ILLMClient;
  try {
    client = await deps.clientResolver(parsed.profileName);
  } catch (e) {
    deps.logger.warn("client resolver failed", { profile: parsed.profileName, message: e instanceof Error ? e.message : String(e) });
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
    return new Response(JSON.stringify({
      content: r.message.content,
      stopReason: r.message.stopReason,
      usage: r.message.usage,
      model: r.message.model,
    }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return mapLlmError(e, deps.logger);
  }
}

export async function handleAiChatStream(req: Request, deps: AiChatRouteDeps): Promise<Response> {
  if (req.method !== "POST") return err(405, ErrorCode.INTERNAL, `method ${req.method} not allowed`);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, ErrorCode.VALIDATION_FAILED, "invalid JSON body");
  }
  const parsed = parseRequest(raw, deps.config);
  if (!parsed.ok) return parsed.response;

  let client: ILLMClient;
  try {
    client = await deps.clientResolver(parsed.profileName);
  } catch (e) {
    deps.logger.warn("client resolver failed (stream)", { profile: parsed.profileName, message: e instanceof Error ? e.message : String(e) });
    return err(400, ErrorCode.VALIDATION_FAILED, e instanceof Error ? e.message : "no client");
  }

  // 阶段 H：带 toolNames → agent loop；否则原 StreamChatUseCase
  if (parsed.toolNames && parsed.toolNames.length > 0) {
    if (!deps.toolRegistry) {
      return err(503, ErrorCode.INTERNAL, "tool registry not wired for this chat route");
    }
    const toolSpecs = pickToolSpecs(deps.toolRegistry, parsed.toolNames);
    if (toolSpecs.length === 0) {
      return err(400, ErrorCode.VALIDATION_FAILED, `none of toolNames found in registry: ${parsed.toolNames.join(",")}`);
    }
    const executor = new ToolExecutor({
      registry: deps.toolRegistry,
      logger: deps.logger,
      cwd: deps.toolCwd ?? Deno.cwd(),
      allowedPaths: deps.toolAllowedPaths ?? [],
      defaultTimeoutMs: 30_000,
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