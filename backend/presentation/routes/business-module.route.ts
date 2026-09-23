/**
 * business-module.route —— 业务模块通用 CRUD 路由
 *
 * 阶段 7.0 + 7.1。
 *
 * 通用 CRUD：
 *   GET    /api/projects/:id/modules/:kind/items                 列表
 *   POST   /api/projects/:id/modules/:kind/items                 新建
 *   GET    /api/modules/items/:itemId                            单条
 *   PATCH  /api/modules/items/:itemId                            更新（含切换 status）
 *   DELETE /api/modules/items/:itemId                            删除
 *   POST   /api/modules/items/:itemId/adopt                      标记采纳
 *   POST   /api/modules/items/:itemId/unadopt                    标记不采用
 *   POST   /api/modules/items/:itemId/generate                   AI 占位生成（仅 kind=custom）
 *
 * 调查任务专用（kind="survey_task"）：
 *   POST   /api/modules/items/:itemId/start                      异步执行
 *   POST   /api/modules/items/:itemId/stop                       终止
 *
 * 设计要点：
 *   - 单条接口走全局路径而非 `/projects/:id/modules/:kind/items/:itemId`，
 *     因为 itemId 已经唯一，不需要双键定位
 *   - markdown_* 与结构化模块共用同一份 handler，按 kind 区别 payload 含义
 *   - survey_task 暴露 start/stop 子路由，调用 SurveyTaskUseCase
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import {
  type BusinessModuleService,
  type CreateItemInput,
  type UpdateItemInput,
} from "@backend/application/business-module/business-module.service.ts";
import type { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import type { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import {
  isMarkdownKind,
  type BusinessModuleKind,
} from "@backend/domain/business-module/business-module.ts";
import { isSurveyTaskKind, SURVEY_TASK_KIND } from "@backend/domain/business-module/survey-task.ts";
import { FUNCTION_LIST_KIND } from "@backend/domain/business-module/function-list.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type {
  BusinessModuleItemDTO,
  CreateBusinessModuleItemDTO,
  UpdateBusinessModuleItemDTO,
} from "@shared/types/dto/business-module.ts";

export interface BusinessModuleRouteDeps {
  service: BusinessModuleService;
  /** 阶段 7.1：调查任务专用用例（不传则 start/stop 返回 501） */
  surveyTaskUseCase?: SurveyTaskUseCase;
  /** 阶段 7.5（H1）：结构化模块用例（功能列表 AI 生成；不传返 501） */
  structuredModulesUseCase?: StructuredModulesUseCase;
  logger: Logger;
}

const VALID_KINDS = new Set<string>([
  "activity",
  "survey_task",
  "survey_questionnaire",
  "use_case",
  "function_list",
  "budget_settings",
  "deliverable",
  "review",
  "ppt",
  "custom",
  "markdown_business_current",
  "markdown_pain_point",
  "markdown_improvement",
  "markdown_proposal",
  "markdown_non_functional",
  "markdown_it_environment",
  "markdown_risk",
  "markdown_to_be",
  "markdown_roi",
  "markdown_precondition",
  "markdown_hardware_cost",
]);

function isValidKind(s: string): s is BusinessModuleKind {
  return VALID_KINDS.has(s);
}

function snapshotToDto(snap: {
  id: string;
  projectId: ProjectId;
  kind: BusinessModuleKind;
  title: string;
  content: string;
  status: "pending" | "adopted" | "unadopted";
  payloadJson: string;
  createdAt: Date;
  updatedAt: Date;
}): BusinessModuleItemDTO {
  return {
    id: snap.id,
    projectId: snap.projectId,
    kind: snap.kind,
    title: snap.title,
    content: snap.content,
    status: snap.status,
    payloadJson: snap.payloadJson,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

export async function handleBusinessModule(
  req: Request,
  deps: BusinessModuleRouteDeps,
  path: string,
): Promise<Response> {
  const method = req.method;
  const url = new URL(req.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  // 列表 + 新建：/api/projects/:id/modules/:kind/items
  const listMatch = /^\/api\/projects\/([^/]+)\/modules\/([^/]+)\/items\/?$/.exec(path);
  if (listMatch) {
    const projectId = listMatch[1];
    const kindStr = listMatch[2];
    if (!projectId || !kindStr) return json({ code: "BAD_REQUEST", message: "invalid path", traceId: "" }, 400);
    if (!isValidKind(kindStr)) {
      return json({ code: "BAD_REQUEST", message: `unknown kind: ${kindStr}`, traceId: "" }, 400);
    }
    const kind = kindStr as BusinessModuleKind;
    const pid = toProjectId(projectId);

    if (method === "GET") {
      const statusQ = url.searchParams.get("status");
      const status = statusQ === "pending" || statusQ === "adopted" || statusQ === "unadopted"
        ? statusQ
        : undefined;
      const items = await deps.service.listItems(pid, kind, status ? { status } : undefined);
      return json({ items: items.map(snapshotToDto), kind, projectId });
    }

    if (method === "POST") {
      // 调查任务批量生成：POST /api/projects/:id/modules/survey_task/items?action=batchGenerate
      //   body: { topics: string[] }
      if (kind === SURVEY_TASK_KIND && url.searchParams.get("action") === "batchGenerate") {
        if (!deps.surveyTaskUseCase) {
          return json({ code: "NOT_IMPLEMENTED", message: "survey task use case not wired", traceId: "" }, 501);
        }
        let body: { topics?: unknown };
        try {
          body = await req.json() as { topics?: unknown };
        } catch {
          return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
        }
        if (!Array.isArray(body.topics) || body.topics.some((t) => typeof t !== "string")) {
          return json({ code: "BAD_REQUEST", message: "topics must be a string[]", traceId: "" }, 400);
        }
        const r = await deps.surveyTaskUseCase.batchGenerate(pid, body.topics as string[]);
        if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
        return json({ items: r.value }, 201);
      }

      // 阶段 7.5（H1）：功能列表 AI 一键生成
      //   POST /api/projects/:id/modules/function_list/items?action=batchFromSubAgent
      //   body: { prompt?: string; count?: number }
      if (kind === FUNCTION_LIST_KIND && url.searchParams.get("action") === "batchFromSubAgent") {
        if (!deps.structuredModulesUseCase) {
          return json({ code: "NOT_IMPLEMENTED", message: "structured modules use case not wired", traceId: "" }, 501);
        }
        let body: { prompt?: unknown; count?: unknown };
        try {
          body = (await req.json().catch(() => ({}))) as { prompt?: unknown; count?: unknown };
        } catch {
          body = {};
        }
        const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
        const count = typeof body.count === "number" && Number.isFinite(body.count) ? body.count : undefined;
        const r = await deps.structuredModulesUseCase.batchFromSubAgent(
          pid,
          { prompt, count },
          { signal: req.signal },
        );
        if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
        return json({ items: r.value.created }, 201);
      }

      let body: CreateBusinessModuleItemDTO;
      try {
        body = await req.json() as CreateBusinessModuleItemDTO;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (!body.title || typeof body.title !== "string") {
        return json({ code: "BAD_REQUEST", message: "title is required", traceId: "" }, 400);
      }
      const input: CreateItemInput = {
        title: body.title,
        content: body.content,
        payloadJson: body.payloadJson,
        initialStatus: body.initialStatus,
      };
      // 调查任务：把 topicHint 注入 payload（通过 SurveyTaskUseCase.create 走更稳）
      if (kind === SURVEY_TASK_KIND) {
        if (!deps.surveyTaskUseCase) {
          return json({ code: "NOT_IMPLEMENTED", message: "survey task use case not wired", traceId: "" }, 501);
        }
        const detail = typeof body.content === "string" ? body.content : "";
        const payload = body.payloadJson ? JSON.parse(body.payloadJson) : {};
        const topicHint = typeof payload.topicHint === "string" ? payload.topicHint : undefined;
        const r = await deps.surveyTaskUseCase.create(pid, body.title, detail, { topicHint });
        if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
        return json(r.value, 201);
      }
      const r: DomainResult<unknown> = await deps.service.createItem(pid, kind, input);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      // markdown 模块默认 adopted —— 忽略 unused 警告
      void isMarkdownKind(kind);
      return json(snapshotToDto(r.value as Parameters<typeof snapshotToDto>[0]), 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  // 单条操作：/api/modules/items/:itemId[/action]
  const itemMatch = /^\/api\/modules\/items\/([^/]+)\/?$/.exec(path);
  const itemActionMatch = /^\/api\/modules\/items\/([^/]+)\/(adopt|unadopt|start|stop|generate)\/?$/.exec(path);
  const itemIdMatch = itemActionMatch ?? itemMatch;
  if (itemIdMatch) {
    const itemId = itemIdMatch[1];
    if (!itemId) return json({ code: "BAD_REQUEST", message: "invalid item id", traceId: "" }, 400);
    if (itemActionMatch && method === "POST") {
      const action = itemActionMatch[2];
      if (action === "adopt" || action === "unadopt") {
        const r = action === "adopt"
          ? await deps.service.adopt(itemId)
          : await deps.service.unadopt(itemId);
        if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
        return json(snapshotToDto(r.value as Parameters<typeof snapshotToDto>[0]));
      }
      // generate：自定义页面专用（kind="custom"）
      if (action === "generate") {
        const r = await deps.service.generatePlaceholder(itemId);
        if (!r.ok) {
          // NOT_FOUND → 404，其他 → 400
          const status = r.error.code === "NOT_FOUND" ? 404 : 400;
          return json({ code: r.error.code, message: r.error.message, traceId: "" }, status);
        }
        return json(snapshotToDto(r.value as Parameters<typeof snapshotToDto>[0]));
      }
      // start / stop：调查任务专用
      if (!deps.surveyTaskUseCase) {
        return json({ code: "NOT_IMPLEMENTED", message: "survey task use case not wired", traceId: "" }, 501);
      }
      // 仅 survey_task 允许 start/stop；其他 kind 返回 400
      const cur = await deps.service.getItem(itemId);
      if (!cur.ok) return json({ code: cur.error.code, message: cur.error.message, traceId: "" }, 400);
      if (!isSurveyTaskKind(cur.value.kind)) {
        return json({ code: "BAD_REQUEST", message: `${action} only supported on survey_task`, traceId: "" }, 400);
      }
      const r = action === "start"
        ? await deps.surveyTaskUseCase.start(itemId)
        : await deps.surveyTaskUseCase.stop(itemId);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (itemMatch && method === "GET") {
      const r = await deps.service.getItem(itemId);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 404);
      // survey_task 单独返回 taskStatus + resultContent 字段
      if (isSurveyTaskKind(r.value.kind) && deps.surveyTaskUseCase) {
        const tr = await deps.surveyTaskUseCase.get(itemId);
        if (tr.ok) return json(tr.value);
      }
      return json(snapshotToDto(r.value as Parameters<typeof snapshotToDto>[0]));
    }
    if (itemMatch && method === "PATCH") {
      let body: UpdateBusinessModuleItemDTO;
      try {
        body = await req.json() as UpdateBusinessModuleItemDTO;
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      const input: UpdateItemInput = {
        title: body.title,
        content: body.content,
        payloadJson: body.payloadJson,
        status: body.status,
      };
      const r = await deps.service.updateItem(itemId, input);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(snapshotToDto(r.value as Parameters<typeof snapshotToDto>[0]));
    }
    if (itemMatch && method === "DELETE") {
      const r = await deps.service.deleteItem(itemId);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return new Response(null, { status: 204 });
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  return json({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }, 404);
}
