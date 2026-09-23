/**
 * dashboard.route —— 仪表盘聚合端点
 *
 * 阶段 7.4g：
 *   GET /api/dashboard/summary               三张 KPI
 *   GET /api/dashboard/monthly?year=YYYY     月度统计（12 行）
 *   GET /api/dashboard/upcoming-activities?limit=5  待推进活动 TOP
 *
 * 设计：
 *   - 所有端点只读，复用 DashboardUseCase
 *   - 未注入 useCase 时返回 501
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { DashboardUseCase } from "@backend/application/dashboard/dashboard.usecase.ts";

export interface DashboardRouteDeps {
  logger: Logger;
  useCase: DashboardUseCase;
}

export async function handleDashboard(
  req: Request,
  deps: DashboardRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/dashboard/summary" && req.method === "GET") {
    try {
      const summary = await deps.useCase.getSummary();
      return jsonOk(summary);
    } catch (e) {
      return jsonErr(deps.logger, "dashboard.summary failed", e);
    }
  }

  if (path === "/api/dashboard/monthly" && req.method === "GET") {
    const yearParam = url.searchParams.get("year");
    let year: number | undefined;
    if (yearParam) {
      const n = Number(yearParam);
      if (!Number.isInteger(n) || n < 1970 || n > 9999) {
        return jsonError(400, "INVALID_INPUT", "year must be a 4-digit integer");
      }
      year = n;
    }
    try {
      const monthly = await deps.useCase.getMonthlyStats(year);
      return jsonOk(monthly);
    } catch (e) {
      return jsonErr(deps.logger, "dashboard.monthly failed", e);
    }
  }

  if (path === "/api/dashboard/upcoming-activities" && req.method === "GET") {
    const limitParam = url.searchParams.get("limit");
    let limit = 5;
    if (limitParam) {
      const n = Number(limitParam);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return jsonError(400, "INVALID_INPUT", "limit must be 1..100");
      }
      limit = n;
    }
    try {
      const items = await deps.useCase.getUpcomingActivities(limit);
      return jsonOk(items);
    } catch (e) {
      return jsonErr(deps.logger, "dashboard.upcoming-activities failed", e);
    }
  }

  return jsonError(404, "NOT_FOUND", `route ${path} not implemented`);
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message, traceId: "" }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErr(logger: Logger, msg: string, e: unknown): Response {
  const detail = e instanceof Error ? e.message : String(e);
  logger.error(msg, { error: detail });
  return jsonError(500, "INTERNAL", detail);
}
