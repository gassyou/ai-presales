/**
 * markdown-module.route —— markdown_* 模块专用端点
 *
 * 阶段 7.3。把 11 个 markdown 模块的统一动作集中到：
 *   GET    /api/projects/:id/modules/:kind/markdown         获取（不存在返回 null）
 *   POST   /api/projects/:id/modules/:kind/markdown         getOrInit（不存在则用模板创建）
 *   PUT    /api/projects/:id/modules/:kind/markdown         保存 content（body: { content }）
 *   POST   /api/projects/:id/modules/:kind/markdown/generate   AI 占位生成
 *   POST   /api/projects/:id/modules/:kind/markdown/adopt      标记采纳
 *   POST   /api/projects/:id/modules/:kind/markdown/unadopt    不采用
 *
 * 与 7.0 通用 CRUD 共存；本端点是"模块专用便捷接口"，前端 markdown 模块用它，
 * 通用 CRUD 主要给"列出所有 kind"等场景用。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { MarkdownModuleService } from "@backend/application/business-module/markdown-module.service.ts";
import {
  isMarkdownKind,
  type BusinessModuleKind,
} from "@backend/domain/business-module/business-module.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";

export interface MarkdownModuleRouteDeps {
  service: MarkdownModuleService;
  logger: Logger;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleMarkdownModule(
  req: Request,
  deps: MarkdownModuleRouteDeps,
  path: string,
): Promise<Response> {
  const method = req.method;
  const actionMatch = /^\/api\/projects\/([^/]+)\/modules\/([^/]+)\/markdown\/(generate|adopt|unadopt)\/?$/.exec(path);
  if (actionMatch) {
    const [, pid, kindStr, action] = actionMatch;
    if (!pid || !kindStr || !action) return json({ code: "BAD_REQUEST", message: "invalid path", traceId: "" }, 400);
    if (!isMarkdownKind(kindStr as BusinessModuleKind)) {
      return json({ code: "BAD_REQUEST", message: `not a markdown kind: ${kindStr}`, traceId: "" }, 400);
    }
    const projectId: ProjectId = toProjectId(pid);
    const kind = kindStr as BusinessModuleKind;

    if (action === "generate") {
      if (method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "POST required", traceId: "" }, 405);
      const r = await deps.service.generateContent(projectId, kind);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (action === "adopt" || action === "unadopt") {
      if (method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "POST required", traceId: "" }, 405);
      // 先 getOrInit 拿到 itemId，再 setAdoption
      const cur = await deps.service.getOrInit(projectId, kind);
      if (!cur.ok) return json({ code: cur.error.code, message: cur.error.message, traceId: "" }, 400);
      const r = await deps.service.setAdoption(cur.value.id, action === "adopt");
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    return json({ code: "NOT_FOUND", message: "unknown action", traceId: "" }, 404);
  }

  const mainMatch = /^\/api\/projects\/([^/]+)\/modules\/([^/]+)\/markdown\/?$/.exec(path);
  if (mainMatch) {
    const [, pid, kindStr] = mainMatch;
    if (!pid || !kindStr) return json({ code: "BAD_REQUEST", message: "invalid path", traceId: "" }, 400);
    if (!isMarkdownKind(kindStr as BusinessModuleKind)) {
      return json({ code: "BAD_REQUEST", message: `not a markdown kind: ${kindStr}`, traceId: "" }, 400);
    }
    const projectId: ProjectId = toProjectId(pid);
    const kind = kindStr as BusinessModuleKind;

    if (method === "GET") {
      const r = await deps.service.get(projectId, kind);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json({ item: r.value });  // null 表示不存在
    }
    if (method === "POST") {
      // 语义：getOrInit
      const r = await deps.service.getOrInit(projectId, kind);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (method === "PUT") {
      let body: { content?: unknown };
      try {
        body = await req.json() as { content?: unknown };
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (typeof body.content !== "string") {
        return json({ code: "BAD_REQUEST", message: "content must be a string", traceId: "" }, 400);
      }
      // 先 getOrInit 拿到 id，再 saveContent
      const cur = await deps.service.getOrInit(projectId, kind);
      if (!cur.ok) return json({ code: cur.error.code, message: cur.error.message, traceId: "" }, 400);
      const r = await deps.service.saveContent(cur.value.id, body.content);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  return json({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }, 404);
}
