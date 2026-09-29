/**
 * auto-mode route —— 阶段 11（任务 11）
 *
 * POST /api/ai/auto-mode
 *   body: { projectId: string, plan?: TaskPlan | "default" }
 *   → 启动 auto-mode 流水线，立即返回 202 + AutoModeResult 占位
 *
 * 注意：阶段 11 是最小骨架：
 *   - orchestrator.run 是同步的（顺序执行任务 + 阻塞）
 *   - SSE / streaming 通过 plan_id 让前端轮询 results（POST 完拿结果）
 *   - 真正 SSE 推到前端将在 sprint 12 加上
 *
 * 阶段 11 阶段必做：
 *   - HTTP 入口收 plan（或默认 plan） → 调 orchestrator.run → 返回 AutoModeResult
 *   - 进度事件暂不通过 HTTP 流；存储到 process log 即可
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { AutoModeOrchestrator } from "@backend/ai/auto-mode/orchestrator.ts";
import { buildDefaultAutoModePlan } from "@backend/ai/auto-mode/orchestrator.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import type { TaskPlan } from "@backend/domain/auto-mode/auto-mode.ts";

export interface AutoModeRouteDeps {
  readonly orchestrator: AutoModeOrchestrator;
  readonly logger: Logger;
}

export async function handleAutoMode(
  req: Request,
  deps: AutoModeRouteDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonErr(405, `method ${req.method} not allowed`);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonErr(400, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const body = (raw ?? {}) as {
    projectId?: string;
    plan?: TaskPlan | "default";
  };

  if (typeof body.projectId !== "string" || body.projectId.length === 0) {
    return jsonErr(400, "projectId is required");
  }
  const projectId = body.projectId as ProjectId;

  const plan: TaskPlan = body.plan === "default" || body.plan === undefined
    ? buildDefaultAutoModePlan(projectId)
    : body.plan;

  if (!plan.projectId || plan.projectId !== projectId) {
    return jsonErr(400, "plan.projectId must match body.projectId");
  }
  if (!plan.tasks || plan.tasks.length === 0) {
    return jsonErr(400, "plan must include at least one task");
  }

  deps.logger.info("auto-mode start", {
    projectId,
    planId: plan.id,
    taskCount: plan.tasks.length,
  });

  try {
    const result = await deps.orchestrator.run(plan);
    deps.logger.info("auto-mode done", {
      projectId,
      planId: plan.id,
      success: result.success,
      totalMs: result.totalMs,
    });
    return jsonOk(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.logger.error("auto-mode failed", { projectId, planId: plan.id, error: msg });
    return jsonErr(500, `auto-mode failed: ${msg}`);
  }
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErr(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: "ERROR", message } }),
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}