/**
 * budget.route —— 预算设置 + 预算汇总（阶段 7.4b）
 *
 *   GET  /api/projects/:id/budget-settings     单例读
 *   PUT  /api/projects/:id/budget-settings     单例 upsert
 *   GET  /api/projects/:id/budget-summary      派生计算（不存库）
 *
 * function_list CRUD 走既有通用路由 `/api/projects/:id/modules/function_list/items`。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";

export interface BudgetRouteDeps {
  useCase: StructuredModulesUseCase;
  logger: Logger;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const SETTINGS_KEYS = new Set([
  "hoursPerCP",
  "hoursPerDay",
  "unitPrice",
  "reqAnalysisRatio",
  "basicDesignRatio",
  "testRatio",
  "managementRatio",
  "bufferRatio",
  "deployDays",
  "trainingDays",
]);

function pickNumbers(body: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!SETTINGS_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export async function handleBudget(
  req: Request,
  deps: BudgetRouteDeps,
  path: string,
): Promise<Response> {
  const method = req.method;

  // /api/projects/:id/budget-settings
  const settingsMatch = /^\/api\/projects\/([^/]+)\/budget-settings\/?$/.exec(path);
  if (settingsMatch) {
    const projectId = settingsMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method === "GET") {
      const settings = await deps.useCase.getBudgetSettings(pid);
      return json(settings);
    }
    if (method === "PUT") {
      let body: Record<string, unknown>;
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      const r = await deps.useCase.updateBudgetSettings(pid, pickNumbers(body));
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // /api/projects/:id/budget-summary
  const summaryMatch = /^\/api\/projects\/([^/]+)\/budget-summary\/?$/.exec(path);
  if (summaryMatch) {
    const projectId = summaryMatch[1];
    if (!projectId) return json({ code: "BAD_REQUEST", message: "invalid project id", traceId: "" }, 400);
    const pid = toProjectId(projectId);
    if (method !== "GET") {
      return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
    }
    const r = await deps.useCase.computeBudgetSummary(pid);
    if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
    return json(r.value);
  }

  return json({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }, 404);
}
