/**
 * /api/projects/:id/quote + /quote/runs 路由
 *
 * 阶段 7.4f。
 *
 * 端点：
 *   - GET    /api/projects/:id/quote                   → 实时派生
 *   - POST   /api/projects/:id/quote/draft             → AI 起草 markdown
 *   - POST   /api/projects/:id/quote/generate          → 生成 .xlsx
 *   - GET    /api/projects/:id/quote/runs              → 历史
 *   - GET    /api/projects/:id/quote/runs/:runId       → run 元数据
 *   - GET    /api/projects/:id/quote/runs/:runId/download → 下载 xlsx
 *   - DELETE /api/projects/:id/quote/runs/:runId       → 删除 run
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { QuoteUseCase } from "@backend/application/quote/quote.usecase.ts";

export interface QuoteRouteDeps {
  logger: Logger;
  useCase: QuoteUseCase;
}

function errResponse(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleQuote(
  req: Request,
  deps: QuoteRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // 实时派生
  const computeMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/quote\/?$/.exec(path);
  if (computeMatch) {
    const pid = toProjectId(computeMatch[1]);
    if (method === "GET") {
      const r = await deps.useCase.computeQuote(pid);
      if (!r.ok) return errResponse(500, r.error.code, r.error.message);
      return new Response(JSON.stringify(r.value), {
        headers: { "content-type": "application/json" },
      });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  // AI 起草
  const draftMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/quote\/draft\/?$/.exec(path);
  if (draftMatch) {
    const pid = toProjectId(draftMatch[1]);
    if (method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return errResponse(400, "INVALID_INPUT", "invalid JSON");
      }
      const userInput = (body.userInput as string) ?? "";
      const r = await deps.useCase.aiGenerateDraft(pid, userInput);
      if (!r.ok) return errResponse(500, r.error.code, r.error.message);
      return new Response(JSON.stringify(r.value), {
        headers: { "content-type": "application/json" },
      });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  // 生成 .xlsx
  const genMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/quote\/generate\/?$/.exec(path);
  if (genMatch) {
    const pid = toProjectId(genMatch[1]);
    if (method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return errResponse(400, "INVALID_INPUT", "invalid JSON");
      }
      const args = {
        templateId: typeof body.templateId === "string" ? body.templateId : undefined,
        userInput: (body.userInput as string) ?? "",
        aiMarkdown: typeof body.aiMarkdown === "string" ? body.aiMarkdown : undefined,
      };
      const r = await deps.useCase.generateXlsx(pid, args);
      if (!r.ok) return errResponse(500, r.error.code, r.error.message);
      return new Response(
        JSON.stringify({ runId: r.value.runId, filename: r.value.filename, mimeType: r.value.mimeType }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  // 列出 runs
  const listRunsMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/quote\/runs\/?$/.exec(path);
  if (listRunsMatch) {
    const pid = toProjectId(listRunsMatch[1]);
    if (method === "GET") {
      const items = await deps.useCase.listRuns(pid);
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
      });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  // 单条 run / 下载 / 删除
  const runMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/quote\/runs\/([0-9a-fA-F-]{36})(\/download)?\/?$/.exec(path);
  if (runMatch) {
    const runId = runMatch[2];
    const isDownload = runMatch[3] === "/download";
    if (isDownload && method === "GET") {
      const r = await deps.useCase.downloadRun(runId);
      if (!r.ok) return errResponse(404, r.error.code, r.error.message);
      return new Response(r.value.bytes as BodyInit, {
        headers: {
          "content-type": r.value.mimeType,
          "content-disposition": `attachment; filename="${r.value.filename}"`,
          "content-length": String(r.value.bytes.byteLength),
        },
      });
    }
    if (!isDownload && method === "GET") {
      const r = await deps.useCase.getRun(runId);
      if (!r.ok) return errResponse(404, r.error.code, r.error.message);
      return new Response(JSON.stringify(r.value), {
        headers: { "content-type": "application/json" },
      });
    }
    if (!isDownload && method === "DELETE") {
      const r = await deps.useCase.deleteRun(runId);
      if (!r.ok) return errResponse(404, r.error.code, r.error.message);
      return new Response(null, { status: 204 });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  return errResponse(404, "NOT_FOUND", `path ${path} not matched`);
}