/**
 * ChatSessionRoute —— 阶段 6 / 任务 6
 *
 * 路由：
 *   GET    /api/chat/sessions                → 列出所有（或按 ?projectId= 过滤）
 *   POST   /api/chat/sessions                → 创建会话
 *   GET    /api/chat/sessions/:id            → 查单个会话
 *   PATCH  /api/chat/sessions/:id            → 改名
 *   DELETE /api/chat/sessions/:id            → 删除会话（含 messages）
 *   GET    /api/chat/sessions/:id/messages   → 列消息
 *   POST   /api/chat/sessions/:id/messages   → 追加消息
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
import type { ChatMessageDTO } from "@backend/domain/chat-session/chat-session.ts";
import type { ProjectId } from "@shared/types/ids.ts";

export interface ChatSessionRouteDeps {
  readonly useCase: ChatSessionUseCase;
  readonly logger: Logger;
}

export async function handleChatSession(
  req: Request,
  deps: ChatSessionRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // /api/chat/sessions/:id/messages
  const m = path.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === "GET") return await listMessages(req, deps, id);
    if (method === "POST") return await appendMessage(req, deps, id);
    return jsonErr(405, `method ${method} not allowed`);
  }

  // /api/chat/sessions/:id
  const sid = path.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  if (sid) {
    const id = decodeURIComponent(sid[1]);
    if (method === "GET") return await getSession(req, deps, id);
    if (method === "PATCH") return await renameSession(req, deps, id);
    if (method === "DELETE") return await deleteSession(req, deps, id);
    return jsonErr(405, `method ${method} not allowed`);
  }

  // /api/chat/sessions
  if (path === "/api/chat/sessions") {
    if (method === "GET") return await listSessions(req, deps, url);
    if (method === "POST") return await createSession(req, deps);
    return jsonErr(405, `method ${method} not allowed`);
  }

  return jsonErr(404, "not found");
}

async function listSessions(
  req: Request,
  deps: ChatSessionRouteDeps,
  url: URL,
): Promise<Response> {
  const projectIdRaw = url.searchParams.get("projectId");
  let projectId: ProjectId | null = null;
  if (projectIdRaw !== null) {
    projectId = projectIdRaw as ProjectId;
  }
  try {
    const items = projectId === null
      ? deps.useCase.listAllSessions()
      : deps.useCase.listSessionsByProject(projectId);
    return jsonOk({ items });
  } catch (e) {
    return jsonErrSrv(deps.logger, "list chat sessions failed", e);
  }
}

async function createSession(
  req: Request,
  deps: ChatSessionRouteDeps,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonErr(400, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as {
    projectId?: string | null;
    title?: string;
  };
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return jsonErr(400, "title is required and must be non-empty");
  }
  try {
    const r = deps.useCase.createSession({
      projectId: (body.projectId ?? null) as ProjectId | null,
      title: body.title,
    });
    if (!r.ok) return jsonErr(400, r.error.message);
    return jsonOk(r.value, 201);
  } catch (e) {
    return jsonErrSrv(deps.logger, "create chat session failed", e);
  }
}

async function getSession(
  req: Request,
  deps: ChatSessionRouteDeps,
  id: string,
): Promise<Response> {
  try {
    const r = deps.useCase.getSession(id);
    if (!r.ok) return jsonErr(404, r.error.message);
    return jsonOk(r.value);
  } catch (e) {
    return jsonErrSrv(deps.logger, "get chat session failed", e);
  }
}

async function renameSession(
  req: Request,
  deps: ChatSessionRouteDeps,
  id: string,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonErr(400, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as { title?: string; autoApprove?: boolean };
  // 阶段 13（PR #8）：PATCH 允许多字段。title / autoApprove 至少给一个。
  const wantTitle = typeof body.title === "string" && body.title.trim().length > 0;
  const wantAutoApprove = typeof body.autoApprove === "boolean";
  if (!wantTitle && !wantAutoApprove) {
    return jsonErr(400, "title (non-empty string) or autoApprove (boolean) is required");
  }
  try {
    // 阶段 13（PR #8）：先改 title，再改 auto-approve（顺序无所谓；失败第一个先返）
    if (wantTitle) {
      const r = deps.useCase.renameSession(id, body.title as string);
      if (!r.ok) return jsonErr(r.error.code === "NOT_FOUND" ? 404 : 400, r.error.message);
    }
    if (wantAutoApprove) {
      const r = deps.useCase.setAutoApprove(id, body.autoApprove as boolean);
      if (!r.ok) return jsonErr(r.error.code === "NOT_FOUND" ? 404 : 400, r.error.message);
    }
    const got = deps.useCase.getSession(id);
    if (!got.ok) return jsonErr(404, got.error.message);
    return jsonOk(got.value);
  } catch (e) {
    return jsonErrSrv(deps.logger, "patch chat session failed", e);
  }
}

async function deleteSession(
  req: Request,
  deps: ChatSessionRouteDeps,
  id: string,
): Promise<Response> {
  try {
    const r = deps.useCase.deleteSession(id);
    if (!r.ok) return jsonErr(404, r.error.message);
    return new Response(null, { status: 204 });
  } catch (e) {
    return jsonErrSrv(deps.logger, "delete chat session failed", e);
  }
}

async function listMessages(
  req: Request,
  deps: ChatSessionRouteDeps,
  sessionId: string,
): Promise<Response> {
  try {
    const r = deps.useCase.listMessages(sessionId);
    if (!r.ok) return jsonErr(404, r.error.message);
    return jsonOk({ items: r.value });
  } catch (e) {
    return jsonErrSrv(deps.logger, "list chat messages failed", e);
  }
}

async function appendMessage(
  req: Request,
  deps: ChatSessionRouteDeps,
  sessionId: string,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonErr(400, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as {
    role?: ChatMessageDTO["role"];
    content?: string;
    toolCalls?: ChatMessageDTO["toolCalls"];
  };
  if (typeof body.role !== "string" || typeof body.content !== "string") {
    return jsonErr(400, "role and content are required");
  }
  try {
    const r = deps.useCase.appendMessage({
      sessionId,
      role: body.role,
      content: body.content,
      ...(body.toolCalls !== undefined ? { toolCalls: body.toolCalls } : {}),
    });
    if (!r.ok) return jsonErr(r.error.code === "NOT_FOUND" ? 404 : 400, r.error.message);
    return jsonOk(r.value, 201);
  } catch (e) {
    return jsonErrSrv(deps.logger, "append chat message failed", e);
  }
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { code: "ERROR", message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErrSrv(logger: Logger, label: string, e: unknown): Response {
  const msg = e instanceof Error ? e.message : String(e);
  logger.warn(label, { error: msg });
  return jsonErr(500, msg);
}
