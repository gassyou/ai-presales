/**
 * ppt.route —— 提案 PPT 设计路由（阶段 7.4c）
 *
 *   GET    /api/projects/:id/ppt/pages             列表
 *   POST   /api/projects/:id/ppt/pages             新建 { title, prompt?, ordinal?, positionX?, positionY? }
 *   PATCH  /api/modules/ppt/pages/:id              更新
 *   DELETE /api/modules/ppt/pages/:id              删除
 *   POST   /api/projects/:id/ppt/pages/reorder     重排 { ids: string[] }
 *   GET    /api/projects/:id/ppt/pages/export      导出 Markdown
 *   POST   /api/projects/:id/ppt/pages/generate    流式 AI 生成（SSE）
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { PptUseCase } from "@backend/application/business-module/ppt.usecase.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { AppConfig, ProfileConfig } from "@backend/infrastructure/config/types.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import { buildSseResponse } from "../sse/sse-writer.ts";

export interface PptRouteDeps {
  useCase: PptUseCase;
  logger: Logger;
  config: AppConfig;
  clientResolver: (profileName: string) => Promise<ILLMClient>;
  /** 默认 profile 名（生成时 fallback） */
  defaultProfileName?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** 把 DomainError 映射到 HTTP 状态码 */
function statusFor(code: string): number {
  if (code === "NOT_FOUND") return 404;
  return 400;
}

export async function handlePpt(
  req: Request,
  deps: PptRouteDeps,
  path: string,
): Promise<Response> {
  const method = req.method;

  // 列表 / 新建：/api/projects/:id/ppt/pages
  const listMatch = /^\/api\/projects\/([^/]+)\/ppt\/pages\/?$/.exec(path);
  if (listMatch) {
    const projectId = listMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method === "GET") {
      const items = await deps.useCase.list(pid);
      return json({ items });
    }
    if (method === "POST") {
      let body: {
        title?: unknown; prompt?: unknown; ordinal?: unknown;
        positionX?: unknown; positionY?: unknown;
      };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (typeof body.title !== "string" || body.title.trim().length === 0) {
        return json({ code: "BAD_REQUEST", message: "title is required", traceId: "" }, 400);
      }
      const r = await deps.useCase.create(pid, {
        title: body.title,
        ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
        ...(typeof body.ordinal === "number" ? { ordinal: body.ordinal } : {}),
        ...(typeof body.positionX === "number" ? { positionX: body.positionX } : {}),
        ...(typeof body.positionY === "number" ? { positionY: body.positionY } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, statusFor(r.error.code));
      return json(r.value, 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // 重排：/api/projects/:id/ppt/pages/reorder
  const reorderMatch = /^\/api\/projects\/([^/]+)\/ppt\/pages\/reorder\/?$/.exec(path);
  if (reorderMatch) {
    const projectId = reorderMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method !== "POST") {
      return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
    }
    let body: { ids?: unknown };
    try {
      body = await req.json() as typeof body;
    } catch {
      return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
    }
    if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === "string")) {
      return json({ code: "BAD_REQUEST", message: "ids must be string[]", traceId: "" }, 400);
    }
    const r = await deps.useCase.reorder(pid, body.ids as string[]);
    if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, statusFor(r.error.code));
    return json({ ok: true });
  }

  // 导出：/api/projects/:id/ppt/pages/export
  const exportMatch = /^\/api\/projects\/([^/]+)\/ppt\/pages\/export\/?$/.exec(path);
  if (exportMatch) {
    const projectId = exportMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method !== "GET") {
      return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
    }
    const r = await deps.useCase.exportMarkdown(pid);
    if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, statusFor(r.error.code));
    return json(r.value);
  }

  // AI 生成（SSE）：/api/projects/:id/ppt/pages/generate
  const generateMatch = /^\/api\/projects\/([^/]+)\/ppt\/pages\/generate\/?$/.exec(path);
  if (generateMatch) {
    const projectId = generateMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method !== "POST") {
      return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
    }
    let body: { userInput?: unknown; profile?: unknown };
    try {
      body = await req.json() as typeof body;
    } catch {
      return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
    }
    if (typeof body.userInput !== "string" || body.userInput.trim().length === 0) {
      return json({ code: "BAD_REQUEST", message: "userInput is required", traceId: "" }, 400);
    }
    const profileName = typeof body.profile === "string" ? body.profile
      : deps.defaultProfileName ?? deps.config.defaultProfile;
    const profile: ProfileConfig | undefined = deps.config.profiles[profileName];
    if (!profile) {
      return json({ code: "BAD_REQUEST", message: `unknown profile: ${profileName}`, traceId: "" }, 400);
    }
    let client: ILLMClient;
    try {
      client = await deps.clientResolver(profileName);
    } catch (e) {
      return json({
        code: "BAD_REQUEST",
        message: e instanceof Error ? e.message : "no client",
        traceId: "",
      }, 400);
    }
    const stream = deps.useCase.generatePages(
      pid,
      body.userInput,
      {
        client,
        profile: {
          name: profileName,
          model: profile.model,
          temperature: profile.temperature,
          maxOutputTokens: profile.maxTokens,
        },
      },
      req.signal,
    );
    return buildSseResponse(stream, req.signal, {
      logger: { warn: (msg, meta) => deps.logger.warn(msg, meta ?? {}) },
    });
  }

  // 单条 PATCH/DELETE：/api/modules/ppt/pages/:id
  const itemMatch = /^\/api\/modules\/ppt\/pages\/([^/]+)\/?$/.exec(path);
  if (itemMatch) {
    const id = itemMatch[1];
    if (!id) return json({ code: "BAD_REQUEST", message: "invalid id", traceId: "" }, 400);
    if (method === "DELETE") {
      const r = await deps.useCase.delete(id);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, statusFor(r.error.code));
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      const patch: {
        ordinal?: number; title?: string; prompt?: string;
        positionX?: number; positionY?: number; width?: number; height?: number;
      } = {};
      // 显式拒绝未知字段（避免前端误传 → 静默忽略 → 状态不一致）
      const allowed = new Set([
        "ordinal", "title", "prompt", "positionX", "positionY", "width", "height",
      ]);
      const unknownKeys = Object.keys(body).filter((k) => !allowed.has(k));
      if (unknownKeys.length > 0) {
        return json({
          code: "BAD_REQUEST",
          message: `unknown patch field(s): ${unknownKeys.join(", ")}`,
          traceId: "",
        }, 400);
      }
      if (typeof body.ordinal === "number") patch.ordinal = body.ordinal;
      if (typeof body.title === "string") patch.title = body.title;
      if (typeof body.prompt === "string") patch.prompt = body.prompt;
      if (typeof body.positionX === "number") patch.positionX = body.positionX;
      if (typeof body.positionY === "number") patch.positionY = body.positionY;
      if (typeof body.width === "number") patch.width = body.width;
      if (typeof body.height === "number") patch.height = body.height;
      const r = await deps.useCase.update(id, patch);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, statusFor(r.error.code));
      return json(r.value);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  return json({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }, 404);
}