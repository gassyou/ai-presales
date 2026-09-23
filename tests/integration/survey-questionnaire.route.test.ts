/**
 * 调查问卷路由集成测试
 *
 * 阶段 7.2。
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import { handleSurveyQuestionnaire } from "@backend/presentation/routes/survey-questionnaire.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import type { SurveyQuestionnaireRouteDeps } from "@backend/presentation/routes/survey-questionnaire.route.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
}

function newDb(): Database {
  return new Database({
    paths: {
      root: "/tmp/whatever",
      data: "/tmp/whatever",
      logs: "/tmp/whatever",
      vendor: "/tmp/whatever",
      output: "/tmp/whatever",
    },
    inMemory: true,
    skipExtensions: true,
  });
}

async function setup(): Promise<{ pid: ProjectId; deps: SurveyQuestionnaireRouteDeps }> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const ps = new ProjectService({ repo: projRepo, clock });
  const r = await ps.createProject({ name: "q-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const bmRepo = new SqliteBusinessModuleRepository(db);
  const bmSvc = new BusinessModuleService({ repo: bmRepo, clock });
  return {
    pid: r.value.id,
    deps: {
      logger: makeLogger(),
      useCase: new SurveyQuestionnaireUseCase({ businessModuleService: bmSvc, clock }),
    },
  };
}

const mindmap = {
  id: "root",
  text: "客户满意度",
  children: [
    { id: "a", text: "产品", children: [] },
    { id: "b", text: "服务", children: [] },
  ],
};

Deno.test("GET outline —— 项目下无大纲 → outline=null", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/questionnaire/outline`;
  const res = await handleSurveyQuestionnaire(
    new Request(`http://x${path}`, { method: "GET" }),
    deps,
    path,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { outline: unknown };
  assertEquals(body.outline, null);
});

Deno.test("PUT outline —— 创建大纲；再次 PUT 不创建新 item", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/questionnaire/outline`;
  const a = await handleSurveyQuestionnaire(
    new Request(`http://x${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap }),
    }),
    deps,
    path,
  );
  assertEquals(a.status, 200);
  const aBody = await a.json() as { id: string };
  const b = await handleSurveyQuestionnaire(
    new Request(`http://x${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap: { id: "r2", text: "新", children: [] } }),
    }),
    deps,
    path,
  );
  const bBody = await b.json() as { id: string; mindmap: { text: string } };
  assertEquals(bBody.id, aBody.id);
  assertEquals(bBody.mindmap.text, "新");
});

Deno.test("POST questions —— 创建后 GET 能列出", async () => {
  const { pid, deps } = await setup();
  const outlinePath = `/api/projects/${pid}/questionnaire/outline`;
  const outlineRes = await handleSurveyQuestionnaire(
    new Request(`http://x${outlinePath}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap }),
    }),
    deps,
    outlinePath,
  );
  const outline = await outlineRes.json() as { id: string };

  const qPath = `/api/projects/${pid}/questionnaire/questions`;
  const createRes = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parentId: outline.id,
        ordinal: 0,
        title: "您对产品满意吗？",
        outlinePath: "客户满意度 / 产品",
      }),
    }),
    deps,
    qPath,
  );
  assertEquals(createRes.status, 201);
  const created = await createRes.json() as { id: string; title: string };
  assertEquals(created.title, "您对产品满意吗？");

  const listRes = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}`, { method: "GET" }),
    deps,
    qPath,
  );
  const list = await listRes.json() as { questions: { title: string }[] };
  assertEquals(list.questions.length, 1);
  assertEquals(list.questions[0]!.title, "您对产品满意吗？");

  // 保存回答
  const answerRes = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}/${created.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "非常满意" }),
    }),
    deps,
    `${qPath}/${created.id}/answer`,
  );
  assertEquals(answerRes.status, 200);
  const saved = await answerRes.json() as { answer: string };
  assertEquals(saved.answer, "非常满意");
});

Deno.test("DELETE question —— 删除后 list 减少", async () => {
  const { pid, deps } = await setup();
  const outlinePath = `/api/projects/${pid}/questionnaire/outline`;
  const oRes = await handleSurveyQuestionnaire(
    new Request(`http://x${outlinePath}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap }),
    }),
    deps,
    outlinePath,
  );
  const o = await oRes.json() as { id: string };
  const qPath = `/api/projects/${pid}/questionnaire/questions`;
  const c1 = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: o.id, ordinal: 0, title: "A" }),
    }),
    deps,
    qPath,
  );
  const q1 = await c1.json() as { id: string };
  const c2 = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: o.id, ordinal: 1, title: "B" }),
    }),
    deps,
    qPath,
  );
  void c2;
  const delRes = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}/${q1.id}`, { method: "DELETE" }),
    deps,
    `${qPath}/${q1.id}`,
  );
  assertEquals(delRes.status, 204);

  const listRes = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}`, { method: "GET" }),
    deps,
    qPath,
  );
  const list = await listRes.json() as { questions: unknown[] };
  assertEquals(list.questions.length, 1);
});

Deno.test("POST batch-from-mindmap —— 从脑图展开生成问题", async () => {
  const { pid, deps } = await setup();
  const outlinePath = `/api/projects/${pid}/questionnaire/outline`;
  await handleSurveyQuestionnaire(
    new Request(`http://x${outlinePath}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap }),
    }),
    deps,
    outlinePath,
  );
  const batchPath = `/api/projects/${pid}/questionnaire/batch-from-mindmap`;
  const res = await handleSurveyQuestionnaire(
    new Request(`http://x${batchPath}`, { method: "POST" }),
    deps,
    batchPath,
  );
  assertEquals(res.status, 201);
  const body = await res.json() as { questions: { title: string; outlinePath: string }[] };
  // mindmap 展开后：root + 产品 + 服务 = 3 条
  assertEquals(body.questions.length, 3);
  assertStringIncludes(body.questions[0]!.title, "占位问题");
});

Deno.test("POST batch-from-mindmap —— 未创建大纲 → 404", async () => {
  const { pid, deps } = await setup();
  const batchPath = `/api/projects/${pid}/questionnaire/batch-from-mindmap`;
  const res = await handleSurveyQuestionnaire(
    new Request(`http://x${batchPath}`, { method: "POST" }),
    deps,
    batchPath,
  );
  assertEquals(res.status, 404);
});

Deno.test("PUT outline —— 非法 mindmap 形状 → 400", async () => {
  const { pid, deps } = await setup();
  const path = `/api/projects/${pid}/questionnaire/outline`;
  const res = await handleSurveyQuestionnaire(
    new Request(`http://x${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap: { id: 123, text: "x", children: "oops" } }),
    }),
    deps,
    path,
  );
  assertEquals(res.status, 400);
});

Deno.test("PATCH question —— 更新 title + ordinal", async () => {
  const { pid, deps } = await setup();
  const outlinePath = `/api/projects/${pid}/questionnaire/outline`;
  const oRes = await handleSurveyQuestionnaire(
    new Request(`http://x${outlinePath}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mindmap }),
    }),
    deps,
    outlinePath,
  );
  const o = await oRes.json() as { id: string };
  const qPath = `/api/projects/${pid}/questionnaire/questions`;
  const c = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: o.id, ordinal: 0, title: "原" }),
    }),
    deps,
    qPath,
  );
  const cs = await c.json() as { id: string };
  const patchRes = await handleSurveyQuestionnaire(
    new Request(`http://x${qPath}/${cs.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "新", ordinal: 5 }),
    }),
    deps,
    `${qPath}/${cs.id}`,
  );
  assertEquals(patchRes.status, 200);
  const updated = await patchRes.json() as { title: string; ordinal: number };
  assertEquals(updated.title, "新");
  assertEquals(updated.ordinal, 5);
});
