/**
 * /api/projects/:id/hardware-items + /api/modules/hardware-items/:itemId 路由
 *
 * 阶段 7.4f。
 *
 * 端点：
 *   - GET    /api/projects/:id/hardware-items              → list
 *   - POST   /api/projects/:id/hardware-items              → create
 *   - GET    /api/modules/hardware-items/:itemId           → get
 *   - PATCH  /api/modules/hardware-items/:itemId           → update
 *   - DELETE /api/modules/hardware-items/:itemId           → delete
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { HardwareItemsUseCase } from "@backend/application/business-module/hardware-items.usecase.ts";

export interface HardwareItemsRouteDeps {
  logger: Logger;
  useCase: HardwareItemsUseCase;
}

function errResponse(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleHardwareItems(
  req: Request,
  deps: HardwareItemsRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // 列表 / 创建
  const listMatch = /^\/api\/projects\/([0-9a-fA-F-]{36})\/hardware-items\/?$/.exec(path);
  if (listMatch) {
    const pid = toProjectId(listMatch[1]);
    if (method === "GET") {
      const items = await deps.useCase.list(pid);
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return errResponse(400, "INVALID_INPUT", "invalid JSON");
      }
      const r = await deps.useCase.create(pid, {
        category: (body.category as string) ?? "",
        device: (body.device as string) ?? "",
        spec: (body.spec as string) ?? "",
        qty: Number(body.qty ?? 1),
        unitPrice: Number(body.unitPrice ?? 0),
        remarks: (body.remarks as string) ?? "",
      });
      if (!r.ok) return errResponse(400, r.error.code, r.error.message);
      return new Response(JSON.stringify(r.value), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  // 单条
  const itemMatch = /^\/api\/modules\/hardware-items\/([0-9a-fA-F-]{36})\/?$/.exec(path);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === "GET") {
      const r = await deps.useCase.get(id);
      if (!r.ok) return errResponse(404, r.error.code, r.error.message);
      return new Response(JSON.stringify(r.value), {
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return errResponse(400, "INVALID_INPUT", "invalid JSON");
      }
      const patch: Record<string, unknown> = {};
      if (typeof body.category === "string") patch.category = body.category;
      if (typeof body.device === "string") patch.device = body.device;
      if (typeof body.spec === "string") patch.spec = body.spec;
      if (typeof body.remarks === "string") patch.remarks = body.remarks;
      if (typeof body.qty === "number") patch.qty = body.qty;
      if (typeof body.unitPrice === "number") patch.unitPrice = body.unitPrice;
      const r = await deps.useCase.update(id, patch);
      if (!r.ok) return errResponse(400, r.error.code, r.error.message);
      return new Response(JSON.stringify(r.value), {
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "DELETE") {
      const r = await deps.useCase.delete(id);
      if (!r.ok) return errResponse(404, r.error.code, r.error.message);
      return new Response(null, { status: 204 });
    }
    return errResponse(405, "METHOD_NOT_ALLOWED", `method ${method} not allowed`);
  }

  return errResponse(404, "NOT_FOUND", `path ${path} not matched`);
}