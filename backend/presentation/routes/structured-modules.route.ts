/**
 * structured-modules.route —— 用例 / 交付物 / Review 三个结构化模块的路由
 *
 * 阶段 7.4a。全部走 StructuredModulesUseCase；payload 经 kind 区分。
 *
 * UseCase（kind=use_case）：
 *   GET    /api/projects/:id/use-cases                   列表
 *   POST   /api/projects/:id/use-cases                   新建 { title, detail?, caseId?, businessRules? }
 *   PATCH  /api/use-cases/:itemId                        更新
 *   DELETE /api/use-cases/:itemId                        删除
 *
 * Deliverable（kind=deliverable）：
 *   GET    /api/projects/:id/deliverables                列表
 *   POST   /api/projects/:id/deliverables                新建 { title, type?, owner?, dueDate?, status? }
 *   PATCH  /api/deliverables/:itemId                     更新
 *   DELETE /api/deliverables/:itemId                     删除
 *
 * Review（kind=review）：
 *   GET    /api/projects/:id/reviews                     列表（含 weightedTotal）
 *   POST   /api/projects/:id/reviews                     新建 { title, dimension, score?, weight?, comment? }
 *   PATCH  /api/reviews/:itemId                          更新
 *   DELETE /api/reviews/:itemId                          删除
 *   GET    /api/projects/:id/reviews/summary             总分
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { DeliverableStatus } from "@backend/domain/business-module/deliverable.ts";

export interface StructuredModulesRouteDeps {
  useCase: StructuredModulesUseCase;
  logger: Logger;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const DELIVERABLE_STATUSES: ReadonlySet<DeliverableStatus> = new Set([
  "not_started",
  "in_progress",
  "completed",
  "cancelled",
]);

export async function handleStructuredModules(
  req: Request,
  deps: StructuredModulesRouteDeps,
  path: string,
): Promise<Response> {
  const method = req.method;
  const url = new URL(req.url);

  // UseCase 列表/新建：/api/projects/:id/use-cases
  const ucListMatch = /^\/api\/projects\/([^/]+)\/use-cases\/?$/.exec(path);
  if (ucListMatch) {
    const projectId = ucListMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method === "GET") {
      const items = await deps.useCase.listUseCases(pid);
      return json({ items });
    }
    if (method === "POST") {
      let body: { title?: unknown; detail?: unknown; caseId?: unknown; businessRules?: unknown };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (typeof body.title !== "string") {
        return json({ code: "BAD_REQUEST", message: "title is required", traceId: "" }, 400);
      }
      const r = await deps.useCase.createUseCase(pid, {
        title: body.title,
        ...(typeof body.detail === "string" ? { detail: body.detail } : {}),
        ...(typeof body.caseId === "string" ? { caseId: body.caseId } : {}),
        ...(typeof body.businessRules === "string" ? { businessRules: body.businessRules } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value, 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // UseCase 单条：/api/use-cases/:itemId
  const ucItemMatch = /^\/api\/use-cases\/([^/]+)\/?$/.exec(path);
  if (ucItemMatch) {
    const id = ucItemMatch[1];
    if (!id) return json({ code: "BAD_REQUEST", message: "invalid id", traceId: "" }, 400);
    if (method === "PATCH") {
      let body: { title?: unknown; detail?: unknown; caseId?: unknown; businessRules?: unknown };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      const r = await deps.useCase.updateUseCase(id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.detail === "string" ? { detail: body.detail } : {}),
        ...(typeof body.caseId === "string" ? { caseId: body.caseId } : {}),
        ...(typeof body.businessRules === "string" ? { businessRules: body.businessRules } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (method === "DELETE") {
      const r = await deps.useCase.deleteUseCase(id);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return new Response(null, { status: 204 });
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // Deliverable 列表/新建：/api/projects/:id/deliverables
  const dlListMatch = /^\/api\/projects\/([^/]+)\/deliverables\/?$/.exec(path);
  if (dlListMatch) {
    const projectId = dlListMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method === "GET") {
      const items = await deps.useCase.listDeliverables(pid);
      return json({ items });
    }
    if (method === "POST") {
      let body: {
        title?: unknown;
        type?: unknown;
        owner?: unknown;
        dueDate?: unknown;
        status?: unknown;
      };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (typeof body.title !== "string") {
        return json({ code: "BAD_REQUEST", message: "title is required", traceId: "" }, 400);
      }
      let status: DeliverableStatus | undefined;
      if (typeof body.status === "string" && DELIVERABLE_STATUSES.has(body.status as DeliverableStatus)) {
        status = body.status as DeliverableStatus;
      } else if (body.status !== undefined) {
        return json({ code: "BAD_REQUEST", message: "invalid status", traceId: "" }, 400);
      }
      const r = await deps.useCase.createDeliverable(pid, {
        title: body.title,
        ...(typeof body.type === "string" ? { type: body.type } : {}),
        ...(typeof body.owner === "string" ? { owner: body.owner } : {}),
        ...(typeof body.dueDate === "string" ? { dueDate: body.dueDate } : {}),
        ...(status ? { status } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value, 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // Deliverable 单条：/api/deliverables/:itemId
  const dlItemMatch = /^\/api\/deliverables\/([^/]+)\/?$/.exec(path);
  if (dlItemMatch) {
    const id = dlItemMatch[1];
    if (!id) return json({ code: "BAD_REQUEST", message: "invalid id", traceId: "" }, 400);
    if (method === "PATCH") {
      let body: {
        title?: unknown;
        type?: unknown;
        owner?: unknown;
        dueDate?: unknown;
        status?: unknown;
      };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      let status: DeliverableStatus | undefined;
      if (typeof body.status === "string" && DELIVERABLE_STATUSES.has(body.status as DeliverableStatus)) {
        status = body.status as DeliverableStatus;
      } else if (body.status !== undefined) {
        return json({ code: "BAD_REQUEST", message: "invalid status", traceId: "" }, 400);
      }
      const r = await deps.useCase.updateDeliverable(id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.type === "string" ? { type: body.type } : {}),
        ...(typeof body.owner === "string" ? { owner: body.owner } : {}),
        ...(typeof body.dueDate === "string" ? { dueDate: body.dueDate } : {}),
        ...(status ? { status } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (method === "DELETE") {
      const r = await deps.useCase.deleteDeliverable(id);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return new Response(null, { status: 204 });
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // Review 列表/新建/汇总：/api/projects/:id/reviews[ /summary]
  const rvListMatch = /^\/api\/projects\/([^/]+)\/reviews\/?$/.exec(path);
  const rvSummaryMatch = /^\/api\/projects\/([^/]+)\/reviews\/summary\/?$/.exec(path);
  if (rvSummaryMatch) {
    const projectId = rvSummaryMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method !== "GET") {
      return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
    }
    const r = await deps.useCase.reviewSummary(pid);
    if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
    return json(r.value);
  }
  if (rvListMatch) {
    const projectId = rvListMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method === "GET") {
      const items = await deps.useCase.listReviews(pid);
      const summary = await deps.useCase.reviewSummary(pid);
      return json({
        items,
        summary: summary.ok ? summary.value : { totalScore: 0, itemCount: 0 },
      });
    }
    if (method === "POST") {
      let body: {
        title?: unknown;
        dimension?: unknown;
        score?: unknown;
        weight?: unknown;
        comment?: unknown;
      };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (typeof body.title !== "string" || typeof body.dimension !== "string") {
        return json({ code: "BAD_REQUEST", message: "title and dimension are required", traceId: "" }, 400);
      }
      const score = typeof body.score === "number" ? body.score : undefined;
      const weight = typeof body.weight === "number" ? body.weight : undefined;
      const r = await deps.useCase.createReview(pid, {
        title: body.title,
        dimension: body.dimension,
        ...(score !== undefined ? { score } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(typeof body.comment === "string" ? { comment: body.comment } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value, 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // Review 单条：/api/reviews/:itemId
  const rvItemMatch = /^\/api\/reviews\/([^/]+)\/?$/.exec(path);
  if (rvItemMatch) {
    const id = rvItemMatch[1];
    if (!id) return json({ code: "BAD_REQUEST", message: "invalid id", traceId: "" }, 400);
    if (method === "PATCH") {
      let body: {
        title?: unknown;
        dimension?: unknown;
        score?: unknown;
        weight?: unknown;
        comment?: unknown;
      };
      try {
        body = await req.json() as typeof body;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      const r = await deps.useCase.updateReview(id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.dimension === "string" ? { dimension: body.dimension } : {}),
        ...(typeof body.score === "number" ? { score: body.score } : {}),
        ...(typeof body.weight === "number" ? { weight: body.weight } : {}),
        ...(typeof body.comment === "string" ? { comment: body.comment } : {}),
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (method === "DELETE") {
      const r = await deps.useCase.deleteReview(id);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return new Response(null, { status: 204 });
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  void url;
  return json({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }, 404);
}
