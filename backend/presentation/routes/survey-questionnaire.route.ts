/**
 * survey-questionnaire.route —— 调查问卷专用路由
 *
 * 阶段 7.2。把问卷的"大纲 + 问题 + 回答"统一到 /api/projects/:id/questionnaire：
 *   GET    /api/projects/:id/questionnaire/outline                 获取大纲（null 表示未创建）
 *   PUT    /api/projects/:id/questionnaire/outline                 保存/创建大纲（body: { mindmap })
 *   GET    /api/projects/:id/questionnaire/questions               列出所有问题
 *   POST   /api/projects/:id/questionnaire/questions               新建问题
 *   PATCH  /api/projects/:id/questionnaire/questions/:qid          更新问题
 *   DELETE /api/projects/:id/questionnaire/questions/:qid          删除问题
 *   POST   /api/projects/:id/questionnaire/batch-from-mindmap      从脑图生成初始问题
 *   POST   /api/projects/:id/questionnaire/questions/:qid/answer   保存回答（body: { answer })
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import type { MindmapNode } from "@backend/domain/business-module/survey-questionnaire.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";

export interface SurveyQuestionnaireRouteDeps {
  useCase: SurveyQuestionnaireUseCase;
  logger: Logger;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isValidMindmap(x: unknown): x is MindmapNode | null {
  if (x === null) return true;
  if (typeof x !== "object" || x === null) return false;
  const n = x as Partial<MindmapNode>;
  if (typeof n.id !== "string" || typeof n.text !== "string") return false;
  if (!Array.isArray(n.children)) return false;
  for (const c of n.children) if (!isValidMindmap(c)) return false;
  return true;
}

export async function handleSurveyQuestionnaire(
  req: Request,
  deps: SurveyQuestionnaireRouteDeps,
  path: string,
): Promise<Response> {
  const method = req.method;

  const outlineMatch = /^\/api\/projects\/([^/]+)\/questionnaire\/outline\/?$/.exec(path);
  if (outlineMatch) {
    const pid = outlineMatch[1];
    if (!pid) return json({ code: "BAD_REQUEST", message: "invalid path", traceId: "" }, 400);
    const projectId: ProjectId = toProjectId(pid);
    if (method === "GET") {
      const r = await deps.useCase.getOutline(projectId);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json({ outline: r.value });  // null 表示未创建
    }
    if (method === "PUT") {
      let body: { mindmap?: unknown };
      try {
        body = await req.json() as { mindmap?: unknown };
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (!isValidMindmap(body.mindmap)) {
        return json({ code: "BAD_REQUEST", message: "invalid mindmap shape", traceId: "" }, 400);
      }
      const r = await deps.useCase.saveOutline(projectId, body.mindmap ?? null);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  const questionsMatch = /^\/api\/projects\/([^/]+)\/questionnaire\/questions\/?$/.exec(path);
  if (questionsMatch) {
    const pid = questionsMatch[1];
    if (!pid) return json({ code: "BAD_REQUEST", message: "invalid path", traceId: "" }, 400);
    const projectId: ProjectId = toProjectId(pid);
    if (method === "GET") {
      const outline = await deps.useCase.getOutline(projectId);
      if (!outline.ok) return json({ code: outline.error.code, message: outline.error.message, traceId: "" }, 400);
      if (!outline.value) return json({ questions: [] });
      const r = await deps.useCase.listQuestions(outline.value.id);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json({ questions: r.value });
    }
    if (method === "POST") {
      let body: { parentId?: unknown; ordinal?: unknown; title?: unknown; outlinePath?: unknown };
      try {
        body = await req.json() as { parentId?: unknown; ordinal?: unknown; title?: unknown; outlinePath?: unknown };
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      if (typeof body.parentId !== "string" || typeof body.title !== "string") {
        return json({ code: "BAD_REQUEST", message: "parentId and title required", traceId: "" }, 400);
      }
      const r = await deps.useCase.upsertQuestionInProject(projectId, {
        parentId: body.parentId,
        ordinal: typeof body.ordinal === "number" ? body.ordinal : 0,
        title: body.title,
        outlinePath: typeof body.outlinePath === "string" ? body.outlinePath : undefined,
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value, 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  const qItemMatch = /^\/api\/projects\/([^/]+)\/questionnaire\/questions\/([^/]+)\/?$/.exec(path);
  const qItemActionMatch = /^\/api\/projects\/([^/]+)\/questionnaire\/questions\/([^/]+)\/answer\/?$/.exec(path);
  const qIdMatch = qItemActionMatch ?? qItemMatch;
  if (qIdMatch) {
    const qid = qIdMatch[2];
    if (!qid) return json({ code: "BAD_REQUEST", message: "invalid question id", traceId: "" }, 400);
    if (qItemActionMatch && method === "POST") {
      let body: { answer?: unknown };
      try {
        body = await req.json() as { answer?: unknown };
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      const r = await deps.useCase.saveAnswer(qid, typeof body.answer === "string" ? body.answer : "");
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (qItemMatch && method === "PATCH") {
      let body: { title?: unknown; answer?: unknown; ordinal?: unknown; outlinePath?: unknown };
      try {
        body = await req.json() as { title?: unknown; answer?: unknown; ordinal?: unknown; outlinePath?: unknown };
      } catch {
        return json({ code: "BAD_REQUEST", message: "invalid JSON body", traceId: "" }, 400);
      }
      // 从 payload 重建当前 ordinal/parentId；通过 list + 过滤取当前值
      const projectId: ProjectId = toProjectId(qItemMatch[1]!);
      const outline = await deps.useCase.getOutline(projectId);
      if (!outline.ok || !outline.value) return json({ code: "NOT_FOUND", message: "outline not found", traceId: "" }, 404);
      const listR = await deps.useCase.listQuestions(outline.value.id);
      if (!listR.ok) return json({ code: listR.error.code, message: listR.error.message, traceId: "" }, 400);
      const cur_q = listR.value.find((q) => q.id === qid);
      if (!cur_q) return json({ code: "NOT_FOUND", message: "question not found", traceId: "" }, 404);
      const r = await deps.useCase.upsertQuestionInProject(projectId, {
        questionId: qid,
        parentId: cur_q.parentId,
        ordinal: typeof body.ordinal === "number" ? body.ordinal : cur_q.ordinal,
        title: typeof body.title === "string" ? body.title : cur_q.title,
        outlinePath: typeof body.outlinePath === "string" ? body.outlinePath : cur_q.outlinePath,
        answer: typeof body.answer === "string" ? body.answer : cur_q.answer,
      });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json(r.value);
    }
    if (qItemMatch && method === "DELETE") {
      const r = await deps.useCase.deleteQuestion(qid);
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return new Response(null, { status: 204 });
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  const batchMatch = /^\/api\/projects\/([^/]+)\/questionnaire\/batch-from-mindmap\/?$/.exec(path);
  if (batchMatch) {
    const pid = batchMatch[1];
    if (!pid) return json({ code: "BAD_REQUEST", message: "invalid path", traceId: "" }, 400);
    const projectId: ProjectId = toProjectId(pid);
    if (method === "POST") {
      const outline = await deps.useCase.getOutline(projectId);
      if (!outline.ok) return json({ code: outline.error.code, message: outline.error.message, traceId: "" }, 400);
      if (!outline.value) return json({ code: "NOT_FOUND", message: "outline not found; create outline first", traceId: "" }, 404);
      const r = await deps.useCase.batchFromMindmap(outline.value.id, { signal: req.signal });
      if (!r.ok) return json({ code: r.error.code, message: r.error.message, traceId: "" }, 400);
      return json({ questions: r.value }, 201);
    }
    return json({ code: "METHOD_NOT_ALLOWED", message: `method ${method} not allowed`, traceId: "" }, 405);
  }

  return json({ code: "NOT_FOUND", message: `route ${path} not implemented`, traceId: "" }, 404);
}
