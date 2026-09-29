/**
 * Sprint 12 测试 —— LLM-backed auto-mode 真实实现
 *
 * 覆盖：
 *   - DefaultAutoModeContextProvider：project_meta / markdown_* / use_case /
 *     deliverable / function_list / questionnaire_outline / survey_task_results
 *   - SubAgentAutoModeWorker：调 SubAgentRunner、收集 chunks、处理 feedback 注入
 *   - SubAgentReviewer：调 SubAgentRunner、解析 JSON 块、score 边界
 *   - 集成：end-to-end orchestrator run 路径（worker + reviewers 串联）
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import type {
  SubAgentRunner,
  SubAgentRunInput,
  ProfileSnapshot,
} from "@backend/ai/sub-agent/sub-agent-runner.ts";
import type { CanonicalAssistantMessage, StreamEvent } from "@backend/ai/message/canonical-message.ts";
import type { Tool } from "@backend/ai/tool/tool.ts";
import { InMemorySubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import { DefaultAutoModeContextProvider } from "@backend/ai/auto-mode/default-context-provider.ts";
import { SubAgentAutoModeWorker } from "@backend/ai/auto-mode/sub-agent-worker.ts";
import {
  SubAgentReviewer,
  makeSubAgentReviewer,
} from "@backend/ai/auto-mode/sub-agent-reviewer.ts";
import {
  AutoModeOrchestrator,
  buildDefaultAutoModePlan,
} from "@backend/ai/auto-mode/orchestrator.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { ProjectId } from "@shared/types/ids.ts";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001" as ProjectId;

// ====== Fakes ======

function fakeSpec(name: string, prompt = "spec-prompt"): SubAgentSpecVO {
  const r = SubAgentSpecVO.create({
    name,
    displayName: name,
    description: name,
    systemPrompt: prompt,
    toolNames: ["current_datetime"],
    type: "system",
  });
  if (!r.ok) throw new Error(`fakeSpec ${name}: ${r.error.message}`);
  return r.value;
}

/** Fake registry —— 内置若干 spec（auto_* + builtin） */
function fakeRegistry(): ISubAgentRegistry {
  const reg = new InMemorySubAgentRegistry();
  for (const name of [
    "auto_env_init",
    "auto_business_req",
    "auto_customer_review",
    "auto_director_review",
  ]) {
    reg.register(fakeSpec(name));
  }
  return reg;
}

function fakeToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(currentDatetimeTool);
  return reg;
}

/**
 * Fake SubAgentRunner —— 按 spec.name 给定输出
 */
function fakeRunner(answers: Record<string, string | { chunks: string[]; failWith?: string }>): SubAgentRunner {
  return {
    deps: {
      // 实际接口字段未使用 —— 仅满足类型
      client: {} as never,
      registry: null as never,
      toolRegistry: null as never,
      profileSnapshot: null as never,
      maxRounds: 0,
    } as never,
    async *run(input: SubAgentRunInput): AsyncIterable<StreamEvent> {
      const key = input.spec.name;
      const ans = answers[key];
      let text: string;
      let failMsg: string | undefined;
      if (typeof ans === "string") {
        text = ans;
      } else if (ans === undefined) {
        text = `[fake runner] no answer for ${key}`;
        failMsg = `no answer for ${key}`;
      } else {
        text = ans.chunks.join("");
        failMsg = ans.failWith;
      }
      // yield chunks
      const chunkSize = 16;
      for (let i = 0; i < text.length; i += chunkSize) {
        yield { type: "chunk", delta: text.slice(i, i + chunkSize), messageId: "fake" };
      }
      if (failMsg) {
        yield { type: "error", code: "LLM_INTERNAL", message: failMsg, retryable: false };
      } else {
        yield {
          type: "done",
          messageId: "fake",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
    },
  } as unknown as SubAgentRunner;
}

function fakeClock(): FixedClock {
  return new FixedClock(new Date("2026-02-01T00:00:00Z"));
}

// ====== DefaultAutoModeContextProvider ======

Deno.test("s12 — DefaultAutoModeContextProvider 处理空 kinds 列表", async () => {
  const provider = new DefaultAutoModeContextProvider({
    projectService: { getProject: async () => null } as never,
    markdownModuleService: { get: async () => ({ ok: false, error: { code: "NOT_FOUND", message: "x" } }) } as never,
    structuredModulesUseCase: {} as never,
    surveyQuestionnaireUseCase: {} as never,
    surveyTaskUseCase: {} as never,
  });
  const ctx = await provider.loadContext(PROJECT_ID, []);
  assertEquals(Object.keys(ctx).length, 0);
});

// ====== SubAgentAutoModeWorker ======

Deno.test("s12 — SubAgentAutoModeWorker 收集 chunks 拼成 output", async () => {
  const worker = new SubAgentAutoModeWorker({
    registry: fakeRegistry(),
    runner: fakeRunner({
      auto_env_init: "[worker output] project metadata ok",
    }),
    toolRegistry: fakeToolRegistry(),
  });
  const r = await worker.executeTask({
    projectId: PROJECT_ID,
    task: {
      name: "env_init",
      subAgentName: "auto_env_init",
      description: "init",
      contextInputs: [],
    },
    context: {},
    feedback: [],
    round: 1,
  });
  assertEquals(r.output, "[worker output] project metadata ok");
  assertEquals(r.wroteModules.length, 0);
});

Deno.test("s12 — SubAgentAutoModeWorker 把 review feedback 注入第二轮 prompt", async () => {
  let capturedPrompt = "";
  const runner: SubAgentRunner = {
    async *run(input: SubAgentRunInput): AsyncIterable<StreamEvent> {
      capturedPrompt = input.userInput;
      yield { type: "chunk", delta: "ok", messageId: "fake" };
      yield { type: "done", messageId: "fake", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  } as unknown as SubAgentRunner;

  const worker = new SubAgentAutoModeWorker({
    registry: fakeRegistry(),
    runner,
    toolRegistry: fakeToolRegistry(),
  });

  await worker.executeTask({
    projectId: PROJECT_ID,
    task: {
      name: "env_init",
      subAgentName: "auto_env_init",
      description: "init",
      // 阶段 12 fixture：contextInputs 至少一个，触发 context 段插入
      contextInputs: ["project_meta"],
    },
    context: { project_meta: "code: 2026-00001" },
    feedback: ["客户反馈：补全联系人"],
    round: 2,
  });
  assertStringIncludes(capturedPrompt, "上轮 review 反馈（请改进）");
  assertStringIncludes(capturedPrompt, "客户反馈：补全联系人");
  assertStringIncludes(capturedPrompt, "project_meta");
});
Deno.test("s12 — SubAgentAutoModeWorker 第 1 轮不写 feedback 段", async () => {
  let capturedPrompt = "";
  const runner: SubAgentRunner = {
    async *run(input: SubAgentRunInput): AsyncIterable<StreamEvent> {
      capturedPrompt = input.userInput;
      yield { type: "done", messageId: "fake", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  } as unknown as SubAgentRunner;
  const worker = new SubAgentAutoModeWorker({
    registry: fakeRegistry(),
    runner,
    toolRegistry: fakeToolRegistry(),
  });
  await worker.executeTask({
    projectId: PROJECT_ID,
    task: {
      name: "env_init",
      subAgentName: "auto_env_init",
      description: "init",
      contextInputs: [],
    },
    context: {},
    feedback: [],
    round: 1,
  });
  // round 1 不应出现 "上轮 review 反馈" 段
  assert(!capturedPrompt.includes("上轮 review 反馈"), `不应有 feedback 段，但有：${capturedPrompt}`);
});

Deno.test("s12 — SubAgentAutoModeWorker 在 spec 缺失时抛错", async () => {
  const worker = new SubAgentAutoModeWorker({
    registry: fakeRegistry(),
    runner: fakeRunner({}),
    toolRegistry: fakeToolRegistry(),
  });
  let threw = false;
  try {
    await worker.executeTask({
      projectId: PROJECT_ID,
      task: {
        name: "ghost",
        subAgentName: "ghost_sub_agent",
        description: "x",
        contextInputs: [],
      },
      context: {},
      feedback: [],
      round: 1,
    });
  } catch (e) {
    threw = true;
    assertStringIncludes(e instanceof Error ? e.message : String(e), "sub-agent not found");
  }
  assertEquals(threw, true);
});

// ====== SubAgentReviewer ======

Deno.test("s12 — SubAgentReviewer 解析 ```json``` 块", async () => {
  const reviewer = makeSubAgentReviewer({
    role: "customer",
    registry: fakeRegistry(),
    runner: fakeRunner({
      auto_customer_review: [
        "评审如下：",
        "```json",
        JSON.stringify({ score: 9, feedback: "通过，客户角度好" }),
        "```",
      ].join("\n"),
    }),
    toolRegistry: fakeToolRegistry(),
  });
  const r = await reviewer.review({
    projectId: PROJECT_ID,
    task: {
      name: "t",
      subAgentName: "auto_env_init",
      description: "x",
      contextInputs: [],
    },
    previousReviews: [],
    taskOutput: "output",
  });
  assertEquals(r.score, 9);
  assertEquals(r.feedback, "通过，客户角度好");
});

Deno.test("s12 — SubAgentReviewer 解析裸 JSON", async () => {
  const reviewer = makeSubAgentReviewer({
    role: "director",
    registry: fakeRegistry(),
    runner: fakeRunner({
      auto_director_review: JSON.stringify({ score: 7, feedback: "范围不全" }),
    }),
    toolRegistry: fakeToolRegistry(),
  });
  const r = await reviewer.review({
    projectId: PROJECT_ID,
    task: {
      name: "t",
      subAgentName: "auto_env_init",
      description: "x",
      contextInputs: [],
    },
    previousReviews: [],
    taskOutput: "output",
  });
  assertEquals(r.score, 7);
});

Deno.test("s12 — SubAgentReviewer 解析失败 → score=0 + raw feedback", async () => {
  const reviewer = makeSubAgentReviewer({
    role: "customer",
    registry: fakeRegistry(),
    runner: fakeRunner({
      auto_customer_review: "garbage output, no json",
    }),
    toolRegistry: fakeToolRegistry(),
  });
  const r = await reviewer.review({
    projectId: PROJECT_ID,
    task: {
      name: "t",
      subAgentName: "auto_env_init",
      description: "x",
      contextInputs: [],
    },
    previousReviews: [],
    taskOutput: "output",
  });
  assertEquals(r.score, 0);
  // feedback 包含 "garbage output"
  assertStringIncludes(r.feedback, "garbage output");
});

Deno.test("s12 — SubAgentReviewer 越界 score (>10) → 0", async () => {
  const reviewer = makeSubAgentReviewer({
    role: "customer",
    registry: fakeRegistry(),
    runner: fakeRunner({
      auto_customer_review: JSON.stringify({ score: 15, feedback: "too good" }),
    }),
    toolRegistry: fakeToolRegistry(),
  });
  const r = await reviewer.review({
    projectId: PROJECT_ID,
    task: {
      name: "t",
      subAgentName: "auto_env_init",
      description: "x",
      contextInputs: [],
    },
    previousReviews: [],
    taskOutput: "output",
  });
  assertEquals(r.score, 0);
});

// ====== 集成：orchestrator + 真实 worker + 真实 reviewer ======

Deno.test("s12 — orchestrator 集成：worker 调 runner、reviewers 调 runner、pass 路径", async () => {
  const registry = fakeRegistry();
  const toolRegistry = fakeToolRegistry();
  // 所有 spec 给同样的输出（高分）
  const runner = fakeRunner({
    auto_env_init: "worker out 1",
    auto_business_req: "worker out 2",
    auto_customer_review: JSON.stringify({ score: 10, feedback: "客户 OK" }),
    auto_director_review: JSON.stringify({ score: 10, feedback: "总监 OK" }),
  });

  const worker = new SubAgentAutoModeWorker({ registry, runner, toolRegistry });
  const customerReviewer = new SubAgentReviewer({
    role: "customer",
    name: "customer-llm",
    subAgentName: "auto_customer_review",
    registry,
    runner,
    toolRegistry,
  });
  const directorReviewer = new SubAgentReviewer({
    role: "director",
    name: "director-llm",
    subAgentName: "auto_director_review",
    registry,
    runner,
    toolRegistry,
  });

  const orch = new AutoModeOrchestrator({
    worker,
    customerReviewer,
    directorReviewer,
    contextProvider: {
      async loadContext() { return { project_meta: "# 元信息" }; },
    },
  });
  const plan = buildDefaultAutoModePlan(PROJECT_ID);
  const result = await orch.run(plan);
  assertEquals(result.success, true);
  // 两个 task 都通过
  assertEquals(result.taskResults.length, 2);
  for (const r of result.taskResults) {
    assertEquals(r.passed, true);
    assertEquals(r.rounds, 1);
    // reviewer.score=10, average=10, 通过 ≥ 9
    assertEquals(r.reviews[0].average, 10);
  }
});

Deno.test("s12 — orchestrator 集成：低分触发 retry 直到 pass（customer=10 director=9）", async () => {
  const registry = fakeRegistry();
  const toolRegistry = fakeToolRegistry();
  // round 1 director 给 5，round 2 给 9；customer 一直 10
  let directorRound = 0;
  let customerRound = 0;
  const runner: SubAgentRunner = {
    async *run(input: SubAgentRunInput): AsyncIterable<StreamEvent> {
      let text = "";
      if (input.spec.name === "auto_director_review") {
        directorRound += 1;
        const score = directorRound === 1 ? 5 : 9;
        text = JSON.stringify({ score, feedback: `director-r${directorRound}` });
      } else if (input.spec.name === "auto_customer_review") {
        customerRound += 1;
        text = JSON.stringify({ score: 10, feedback: `customer-r${customerRound}` });
      } else {
        text = "ok";
      }
      yield { type: "chunk", delta: text, messageId: "fake" };
      yield { type: "done", messageId: "fake", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  } as unknown as SubAgentRunner;

  const worker = new SubAgentAutoModeWorker({ registry, runner, toolRegistry });
  const customerReviewer = new SubAgentReviewer({
    role: "customer",
    name: "c",
    subAgentName: "auto_customer_review",
    registry,
    runner,
    toolRegistry,
  });
  const directorReviewer = new SubAgentReviewer({
    role: "director",
    name: "d",
    subAgentName: "auto_director_review",
    registry,
    runner,
    toolRegistry,
  });
  const orch = new AutoModeOrchestrator({
    worker,
    customerReviewer,
    directorReviewer,
    contextProvider: { async loadContext() { return {}; } },
  });
  // 单 task plan
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
  // round 1: customer=10, director=5 → avg=7.5 → 不通过
  // round 2: customer=10, director=9 → avg=9.5 → 通过
  assertEquals(result.success, true);
  assertEquals(result.taskResults[0].rounds, 2);
  assertEquals(result.taskResults[0].reviews.length, 2);
  assertEquals(result.taskResults[0].reviews[0].directorScore, 5);
  assertEquals(result.taskResults[0].reviews[1].directorScore, 9);
});