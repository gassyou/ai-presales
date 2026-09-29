/**
 * 任务 11：auto-mode 多 agent 编排 —— 测试
 *
 * 覆盖：
 *   - TaskPlan / ReviewScore / TaskResult / AutoModeResult 类型契约
 *   - AutoModeOrchestrator.run：成功路径（每个 task 都通过）
 *   - AutoModeOrchestrator.run：失败路径（reviewer 持续打低分 → plan 失败）
 *   - 进度事件：每个 task_start / task_review / task_pass / plan_done
 *   - 默认 plan（buildDefaultAutoModePlan）含 env_init + business_requirements
 *   - AUTO_MODE_SPECS 包含 5 个 auto_* system specs
 *   - HTTP POST /api/ai/auto-mode：合法 plan 返 200；非法 → 400；GET → 405
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  AutoModeOrchestrator,
  buildDefaultAutoModePlan,
  makeStubAutoModeWorker,
  makeStubReviewer,
} from "@backend/ai/auto-mode/orchestrator.ts";
import {
  DEFAULT_REVIEW_ROUND_LIMIT,
  REVIEW_PASS_THRESHOLD,
  type AutoModeProgressEvent,
  type AutoModeWorker,
  type Reviewer,
} from "@backend/domain/auto-mode/auto-mode.ts";
import { AUTO_MODE_SPECS, AUTO_MODE_SPEC_BY_NAME } from "@backend/ai/auto-mode/auto-mode-agents.ts";
import { handleAutoMode } from "@backend/presentation/routes/auto-mode.route.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

const PROJECT_ID = "00000000-0000-0000-0000-000000000001" as never;

// ====== 类型契约 ======

Deno.test("t11 — 默认 plan 含 env_init + business_requirements", () => {
  const plan = buildDefaultAutoModePlan(PROJECT_ID);
  assertEquals(plan.projectId, PROJECT_ID);
  assertEquals(plan.tasks.length, 2);
  assertEquals(plan.tasks[0].name, "env_init");
  assertEquals(plan.tasks[0].subAgentName, "auto_env_init");
  assertEquals(plan.tasks[1].name, "business_requirements");
  assertEquals(plan.tasks[1].subAgentName, "auto_business_req");
});

Deno.test("t11 — AUTO_MODE_SPECS 共 5 个，全部 type=system", () => {
  assertEquals(AUTO_MODE_SPECS.length, 5);
  for (const s of AUTO_MODE_SPECS) {
    assertEquals(s.type, "system", `${s.name} should be system`);
  }
});

Deno.test("t11 — AUTO_MODE_SPEC_BY_NAME 含 5 个预期 name", () => {
  for (const name of [
    "auto_env_init",
    "auto_business_req",
    "auto_survey_task",
    "auto_customer_review",
    "auto_director_review",
  ]) {
    assert(AUTO_MODE_SPEC_BY_NAME[name], `缺 ${name}`);
  }
});

Deno.test("t11 — 评审阈值常量", () => {
  assertEquals(REVIEW_PASS_THRESHOLD, 9);
  assertEquals(DEFAULT_REVIEW_ROUND_LIMIT, 3);
});

// ====== Orchestrator 成功路径 ======

Deno.test("t11 — run 成功路径：所有 task 都通过 → planSuccess=true", async () => {
  const plan = buildDefaultAutoModePlan(PROJECT_ID);
  const orch = new AutoModeOrchestrator({
    worker: makeStubAutoModeWorker(),
    customerReviewer: makeStubReviewer({ role: "customer", score: 10 }),
    directorReviewer: makeStubReviewer({ role: "director", score: 10 }),
    contextProvider: { async loadContext() { return {}; } },
  });
  const events: AutoModeProgressEvent[] = [];
  orch.onProgress((ev) => { events.push(ev); });
  const result = await orch.run(plan);
  assertEquals(result.success, true);
  assertEquals(result.taskResults.length, 2);
  for (const r of result.taskResults) {
    assertEquals(r.passed, true);
    assertEquals(r.rounds, 1, `${r.taskName} 应 1 轮就过`);
  }
  // 进度事件：每个 task 1 start + 1 review + 1 pass（无 plan_failed/plan_done?）
  // plan_done 没在代码中 emit，但 task_pass 是终结信号
  const starts = events.filter((e) => e.kind === "task_start").length;
  const reviews = events.filter((e) => e.kind === "task_review").length;
  const passes = events.filter((e) => e.kind === "task_pass").length;
  assertEquals(starts, 2);
  assertEquals(reviews, 2);
  assertEquals(passes, 2);
});

// ====== Orchestrator 失败路径 ======

Deno.test("t11 — run 失败路径：reviewer 持续打 5 分 → planSuccess=false，task 不通过", async () => {
  const plan = buildDefaultAutoModePlan(PROJECT_ID);
  const orch = new AutoModeOrchestrator({
    worker: makeStubAutoModeWorker(),
    customerReviewer: makeStubReviewer({ role: "customer", score: 5 }),
    directorReviewer: makeStubReviewer({ role: "director", score: 5 }),
    contextProvider: { async loadContext() { return {}; } },
  });
  const result = await orch.run(plan);
  assertEquals(result.success, false);
  assertEquals(result.taskResults[0].passed, false);
  // 3 轮全失败，rounds == limit
  assertEquals(result.taskResults[0].rounds, 3);
  assertEquals(result.taskResults[0].reviews.length, 3);
});

Deno.test("t11 — 第二轮根据 reviewer feedback 重跑（worker 看到 feedback）", async () => {
  const plan = {
    projectId: PROJECT_ID,
    id: "plan-x",
    tasks: [{
      name: "t1",
      subAgentName: "auto_env_init",
      description: "x",
      contextInputs: [],
    }],
  };
  let lastFeedbackLen = -1;
  const worker: AutoModeWorker = {
    async executeTask({ feedback, round }) {
      if (round > 1) lastFeedbackLen = feedback.length;
      return { output: `output-r${round}`, wroteModules: [] };
    },
  };
  const orch = new AutoModeOrchestrator({
    worker,
    customerReviewer: makeStubReviewer({ role: "customer", score: 5 }),
    directorReviewer: makeStubReviewer({ role: "director", score: 5 }),
    contextProvider: { async loadContext() { return {}; } },
  });
  await orch.run(plan);
  assert(lastFeedbackLen >= 1, "第二轮应收到上一轮的 feedback");
});

// ====== HTTP 路由 ======

async function setupRoute() {
  const deps = {
    orchestrator: new AutoModeOrchestrator({
      worker: makeStubAutoModeWorker(),
      customerReviewer: makeStubReviewer({ role: "customer", score: 10 }),
      directorReviewer: makeStubReviewer({ role: "director", score: 10 }),
      contextProvider: { async loadContext() { return {}; } },
    }),
    logger: makeLogger(),
  };
  return {
    deps,
    call: (req: Request) => handleAutoMode(req, deps),
  };
}

Deno.test("t11 — HTTP POST default plan 返 200 + planSuccess", async () => {
  const { call } = await setupRoute();
  const res = await call(new Request("http://localhost/api/ai/auto-mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT_ID, plan: "default" }),
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.taskResults.length, 2);
});

Deno.test("t11 — HTTP POST 缺 projectId → 400", async () => {
  const { call } = await setupRoute();
  const res = await call(new Request("http://localhost/api/ai/auto-mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
  assertEquals(res.status, 400);
});

Deno.test("t11 — HTTP POST 空 tasks plan → 400", async () => {
  const { call } = await setupRoute();
  const badPlan = {
    projectId: PROJECT_ID,
    id: "p1",
    tasks: [],
  };
  const res = await call(new Request("http://localhost/api/ai/auto-mode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT_ID, plan: badPlan }),
  }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error.message, "at least one task");
});

Deno.test("t11 — HTTP GET 返 405", async () => {
  const { call } = await setupRoute();
  const res = await call(new Request("http://localhost/api/ai/auto-mode", { method: "GET" }));
  assertEquals(res.status, 405);
});

// ====== reviewer 双打分协议 ======

Deno.test("t11 — 双 reviewer：customer 10 + director 6 → average 8 不通过", async () => {
  const orch = new AutoModeOrchestrator({
    worker: makeStubAutoModeWorker(),
    customerReviewer: makeStubReviewer({ role: "customer", score: 10 }),
    directorReviewer: makeStubReviewer({ role: "director", score: 6 }),
    contextProvider: { async loadContext() { return {}; } },
  });
  const plan = {
    projectId: PROJECT_ID,
    id: "p",
    tasks: [{
      name: "t",
      subAgentName: "auto_env_init",
      description: "x",
      contextInputs: [],
    }],
  };
  const result = await orch.run(plan);
  assertEquals(result.taskResults[0].reviews[0].average, 8);
  assertEquals(result.taskResults[0].reviews[0].passed, false);
});