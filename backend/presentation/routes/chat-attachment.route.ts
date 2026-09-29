/**
 * ChatAttachmentRoute —— 阶段 13（PR #7 / 用户项 #8）
 *
 * 路由：
 *   POST /api/chat/sessions/:id/attachments    → 上传一个附件（multipart JSON: { fileName, mimeType, contentBase64?, contentText? }）
 *   GET  /api/chat/sessions/:id/attachments    → 列 session 的附件
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ChatAttachmentUseCase } from "@backend/application/chat-attachment/chat-attachment.usecase.ts";
import type { ChatAttachmentRecord } from "@backend/persistence/sqlite/sqlite-chat-attachment.repository.ts";

export interface ChatAttachmentRouteDeps {
  readonly useCase: ChatAttachmentUseCase;
  readonly logger: Logger;
}

export async function handleChatAttachmentRoute(
  req: Request,
  deps: ChatAttachmentRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  const m = path.match(/^\/api\/chat\/sessions\/([^/]+)\/attachments$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === "POST") return await uploadAttachment(req, deps, id);
    if (method === "GET") return listAttachments(deps, id);
    return jsonErr(405, `method ${method} not allowed`);
  }

  return jsonErr(404, "not found");
}

function listAttachments(deps: ChatAttachmentRouteDeps, sessionId: string): Response {
  try {
    const items = deps.useCase.listBySession(sessionId);
    return jsonOk({ items: items.map(toDto) });
  } catch (e) {
    return jsonErrSrv(deps.logger, "list chat attachments failed", e);
  }
}

async function uploadAttachment(
  req: Request,
  deps: ChatAttachmentRouteDeps,
  sessionId: string,
): Promise<Response> {
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const body = (raw ?? {}) as {
    fileName?: string;
    mimeType?: string;
    contentBase64?: string;
    contentText?: string;
  };
  if (typeof body.fileName !== "string" || body.fileName.length === 0) {
    return jsonErr(400, "fileName is required");
  }
  if (typeof body.mimeType !== "string" || body.mimeType.length === 0) {
    return jsonErr(400, "mimeType is required");
  }
  if (
    (typeof body.contentBase64 !== "string" || body.contentBase64.length === 0) &&
    (typeof body.contentText !== "string" || body.contentText.length === 0)
  ) {
    return jsonErr(400, "contentBase64 or contentText required");
  }
  try {
    const rec = await deps.useCase.upload({
      sessionId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      ...(body.contentBase64 !== undefined ? { contentBase64: body.contentBase64 } : {}),
      ...(body.contentText !== undefined ? { contentText: body.contentText } : {}),
    });
    return jsonOk(toDto(rec), 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.logger.warn("upload chat attachment failed", { sessionId, error: msg });
    if (msg.includes("not found")) return jsonErr(404, msg);
    if (msg.includes("size exceeds")) return jsonErr(413, msg);
    if (msg.includes("contentBase64 or contentText required")) return jsonErr(400, msg);
    return jsonErr(500, msg);
  }
}

function toDto(r: ChatAttachmentRecord): ChatAttachmentDTO {
  return {
    id: r.id,
    sessionId: r.sessionId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    parsedSummary: r.parsedSummary,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface ChatAttachmentDTO {
  id: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parsedSummary: string | null;
  createdAt: string;
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
