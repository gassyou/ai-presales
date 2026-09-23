/**
 * /api/quote-templates 路由
 *
 * 阶段 7.4f。
 *
 * 端点：
 *   - GET    /api/quote-templates?projectId=xxx  → 列出内置默认 + 项目上传的
 *   - POST   /api/projects/:id/quote-templates  → 上传 multipart (field=file)
 *   - GET    /api/quote-templates/:id           → 下载字节流
 *   - DELETE /api/quote-templates/:id           → 删除（不允许删内置默认）
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { QuoteUseCase } from "@backend/application/quote/quote.usecase.ts";
import type { FilesystemQuoteStorage } from "@backend/application/quote/quote.storage.ts";

export interface QuoteTemplatesRouteDeps {
  logger: Logger;
  useCase: QuoteUseCase;
  storage: FilesystemQuoteStorage;
}

function errResponse(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleQuoteTemplates(
  req: Request,
  deps: QuoteTemplatesRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // 列表
  if (path === "/api/quote-templates" && method === "GET") {
    const pidStr = url.searchParams.get("projectId");
    if (!pidStr) return errResponse(400, "INVALID_INPUT", "projectId query is required");
    try {
      const items = await deps.useCase.listTemplates(toProjectId(pidStr));
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return errResponse(500, "INTERNAL", e instanceof Error ? e.message : String(e));
    }
  }

  // 上传
  const uploadMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/quote-templates\/?$/.exec(path);
  if (uploadMatch && method === "POST") {
    const pid = toProjectId(uploadMatch[1]);
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) {
      return errResponse(400, "INVALID_INPUT", "multipart/form-data expected");
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return errResponse(400, "INVALID_INPUT", "failed to parse form data");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return errResponse(400, "INVALID_INPUT", "file field is required");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await deps.useCase.uploadTemplate(pid, {
      filename: file.name || "template.xlsx",
      mime: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });
    if (!r.ok) return errResponse(400, r.error.code, r.error.message);
    return new Response(JSON.stringify(r.value), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }

  // 单条
  const itemMatch = /^\/api\/quote-templates\/([0-9a-fA-F-]{36})\/?$/.exec(path);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === "GET") {
      const r = await deps.useCase.findTemplateById(id);
      if (!r.ok) return errResponse(404, r.error.code, r.error.message);
      const found = r.value;
      let bytes: Uint8Array;
      try {
        bytes = await deps.storage.readTemplate(found.pathOnDisk);
      } catch {
        return errResponse(404, "NOT_FOUND", `template file missing: ${found.pathOnDisk}`);
      }
      return new Response(bytes as BodyInit, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${found.originalFilename}"`,
          "content-length": String(bytes.byteLength),
        },
      });
    }
    if (method === "DELETE") {
      const r = await deps.useCase.deleteTemplate(id);
      if (!r.ok) return errResponse(400, r.error.code, r.error.message);
      return new Response(null, { status: 204 });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  return errResponse(404, "NOT_FOUND", `path ${path} not matched`);
}