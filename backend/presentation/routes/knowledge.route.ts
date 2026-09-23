/**
 * /api/projects/:id/knowledge/*
 *
 *   POST /api/projects/:id/knowledge/ingest   → 触发 ingestProject
 *     body: { messageLimit?: number }
 *     response 200: IngestProjectResult
 *
 *   GET  /api/projects/:id/knowledge/status    → IndexStatusResult
 *
 * 设计：
 *   - ingest 走同步路径（项目小，~10K token 文本 + ~3s embed 通常 < 30s）；
 *     后续若项目体量大可改 async job + 进度 SSE
 *   - errors 走 ErrorEnvelope
 *   - ingest 完成后自动 invalidate MentionResolver cache（让 isIndexed 立即生效）
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import {
  type DomainErrorCode,
  type DomainResult,
} from "@backend/domain/shared/result.ts";
import type { ErrorEnvelope, ErrorCodeValue } from "@shared/types/common.ts";
import { ErrorCode } from "@shared/types/common.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { IngestProjectUseCase } from "@backend/application/knowledge/ingest-project.usecase.ts";
import type { IndexStatusUseCase } from "@backend/application/knowledge/index-status.usecase.ts";
import type { MentionResolver } from "@backend/ai/context/providers/mention-resolver.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";

export interface KnowledgeRouteDeps {
  logger: Logger;
  ingest: IngestProjectUseCase;
  status: IndexStatusUseCase;
  /** ingest 完成后让 mention cache 立即生效；可选 */
  mentionResolver?: MentionResolver;
  clock: Clock;
}

function err(status: number, code: ErrorCodeValue, message: string, details?: unknown): Response {
  const body: ErrorEnvelope = details === undefined
    ? { code, message, traceId: "" }
    : { code, message, details, traceId: "" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function mapDomainError(code: DomainErrorCode): { status: number; code: ErrorCodeValue } {
  switch (code) {
    case "INVALID_INPUT":
      return { status: 400, code: ErrorCode.VALIDATION_FAILED };
    case "NOT_FOUND":
      return { status: 404, code: ErrorCode.NOT_FOUND };
    case "CONFLICT":
      return { status: 409, code: ErrorCode.CONFLICT };
    case "ILLEGAL_STATE_TRANSITION":
      return { status: 409, code: ErrorCode.CONFLICT };
    case "INVARIANT_VIOLATED":
      return { status: 422, code: ErrorCode.VALIDATION_FAILED };
    case "INTERNAL":
      return { status: 500, code: ErrorCode.INTERNAL };
  }
}

function unwrap<T>(r: DomainResult<T>): { value?: T; response?: Response } {
  if (r.ok) return { value: r.value };
  const m = mapDomainError(r.error.code);
  return { response: err(m.status, m.code, r.error.message, r.error.details) };
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function handleKnowledge(
  req: Request,
  deps: KnowledgeRouteDeps,
  path: string,
): Promise<Response> {
  const ingestMatch = path.match(
    /^\/api\/projects\/([0-9a-fA-F-]{36})\/knowledge\/ingest$/,
  );
  if (ingestMatch) {
    if (req.method !== "POST") {
      return err(405, ErrorCode.INTERNAL, `method ${req.method} not allowed`);
    }
    return await ingestKnowledge(req, deps, toProjectId(ingestMatch[1]));
  }
  const statusMatch = path.match(
    /^\/api\/projects\/([0-9a-fA-F-]{36})\/knowledge\/status$/,
  );
  if (statusMatch) {
    if (req.method !== "GET") {
      return err(405, ErrorCode.INTERNAL, `method ${req.method} not allowed`);
    }
    return await statusKnowledge(deps, toProjectId(statusMatch[1]));
  }
  return err(404, ErrorCode.NOT_FOUND, `route ${path} not found`);
}

async function ingestKnowledge(
  req: Request,
  deps: KnowledgeRouteDeps,
  id: ProjectId,
): Promise<Response> {
  const raw = await readJson(req);
  const body = (raw ?? {}) as { messageLimit?: number };
  const messageLimit = typeof body.messageLimit === "number" && body.messageLimit > 0
    ? Math.min(body.messageLimit, 5000)
    : undefined;

  deps.logger.info("knowledge ingest start", { projectId: id, messageLimit });
  const r = await deps.ingest.execute({
    projectId: id,
    ...(messageLimit !== undefined ? { messageLimit } : {}),
    clock: deps.clock,
  });
  const u = unwrap(r);
  if (u.response) return u.response;

  deps.mentionResolver?.invalidateCache();
  deps.logger.info("knowledge ingest done", {
    projectId: id,
    scanned: u.value!.scanned,
    indexed: u.value!.indexed,
    totalChunks: u.value!.totalChunks,
    elapsedMs: u.value!.elapsedMs,
    errors: u.value!.errors.length,
  });
  return new Response(JSON.stringify(u.value!), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function statusKnowledge(
  deps: KnowledgeRouteDeps,
  id: ProjectId,
): Promise<Response> {
  const r = await deps.status.execute({ projectId: id });
  const u = unwrap(r);
  if (u.response) return u.response;
  return new Response(JSON.stringify(u.value!), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}