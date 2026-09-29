/**
 * AutoModeOrchestrator —— 阶段 11（任务 11）核心调度器
 *
 * 流程（每个 task）：
 *   1. 加载 context（项目各模块内容）
 *   2. Worker.executeTask(round=1, feedback=[])
 *   3. Reviewer × 2 双打分
 *   4. 若 average < passThreshold 且 round < reviewRoundLimit：合并 feedback，重跑 (round+1)
 *   5. 若通过：写 TaskResult、继续下一个 task
 *   6. 若所有 reviewRoundLimit 用完仍未通过：标记 task 失败，整个 plan 失败
 *
 * 编排器本身不调 LLM；worker / reviewer 通过依赖注入；测试用 fake 实现。
 */

import {
  type AutoModeOrchestratorDeps,
  type AutoModeProgressEvent,
  type AutoModeProgressKind,
  type AutoModeProgressListener,
  type AutoModeResult,
  type AutoModeWorker,
  type Reviewer,
  type ReviewScore,
  DEFAULT_REVIEW_ROUND_LIMIT,
  type TaskPlan,
  type TaskResult,
  type TaskSpec,
} from "@backend/domain/auto-mode/auto-mode.ts";
import { REVIEW_PASS_THRESHOLD } from "@backend/domain/auto-mode/auto-mode.ts";

export class AutoModeOrchestrator {
  private readonly deps: Required<AutoModeOrchestratorDeps>;
  private readonly listeners: AutoModeProgressListener[] = [];

  constructor(deps: AutoModeOrchestratorDeps) {
    this.deps = {
      worker: deps.worker,
      customerReviewer: deps.customerReviewer,
      directorReviewer: deps.directorReviewer,
      contextProvider: deps.contextProvider,
      reviewRoundLimit: deps.reviewRoundLimit ?? DEFAULT_REVIEW_ROUND_LIMIT,
      passThreshold: deps.passThreshold ?? REVIEW_PASS_THRESHOLD,
    };
  }

  /** 订阅进度事件（前端面板用）。返回 unsubscribe。 */
  onProgress(fn: AutoModeProgressListener): () => void {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async run(plan: TaskPlan): Promise<AutoModeResult> {
    const startedAt = Date.now();
    const taskResults: TaskResult[] = [];
    let planSuccess = true;

    for (const task of plan.tasks) {
      const result = await this.runSingleTask(task, plan.projectId);
      taskResults.push(result);
      if (!result.passed) {
        planSuccess = false;
        await this.emit({
          kind: "plan_failed",
          planId: plan.id,
          taskName: task.name,
          message: `plan 失败于任务 ${task.name}`,
          atMs: Date.now() - startedAt,
        });
        break;
      }
    }

    return {
      planId: plan.id,
      projectId: plan.projectId,
      taskResults,
      success: planSuccess,
      totalMs: Date.now() - startedAt,
    };
  }

  /**
   * 跑单个 task；包含"worker + 双 review + 失败重试"循环。
   * 暴露为 protected，便于测试和未来子类扩展。
   */
  private async runSingleTask(
    task: TaskSpec,
    projectId: import("@shared/types/ids.ts").ProjectId,
  ): Promise<TaskResult> {
    await this.emit({
      kind: "task_start",
      planId: projectId,
      taskName: task.name,
      message: `开始任务 ${task.name}`,
      atMs: 0,
    });

    const context = task.contextInputs.length > 0
      ? await this.deps.contextProvider.loadContext(projectId, task.contextInputs)
      : {};

    const reviews: ReviewScore[] = [];
    let wroteModules: readonly import("@backend/domain/auto-mode/auto-mode.ts").ContextInputKind[] = [];
    let lastOutput = "";
    let passed = false;
    let rounds = 0;
    let feedbackForNext: string[] = [];

    for (let round = 1; round <= this.deps.reviewRoundLimit; round++) {
      rounds = round;
      const result = await this.deps.worker.executeTask({
        projectId,
        task,
        context,
        feedback: feedbackForNext,
        round,
      });
      lastOutput = result.output;
      wroteModules = result.wroteModules;

      await this.emit({
        kind: "task_review",
        planId: projectId,
        taskName: task.name,
        round,
        message: `第 ${round}/${this.deps.reviewRoundLimit} 轮 review`,
        atMs: 0,
      });

      // 双 reviewer 并行打分
      const [c, d] = await Promise.all([
        this.deps.customerReviewer.review({
          projectId,
          task,
          previousReviews: reviews,
          taskOutput: lastOutput,
        }),
        this.deps.directorReviewer.review({
          projectId,
          task,
          previousReviews: reviews,
          taskOutput: lastOutput,
        }),
      ]);

      const score: ReviewScore = {
        taskName: task.name,
        round,
        customerScore: c.score,
        directorScore: d.score,
        average: (c.score + d.score) / 2,
        customerFeedback: c.feedback,
        directorFeedback: d.feedback,
        passed: (c.score + d.score) / 2 >= this.deps.passThreshold,
      };
      reviews.push(score);

      await this.emit({
        kind: score.passed ? "task_pass" : "task_fail",
        planId: projectId,
        taskName: task.name,
        round,
        score,
        message: score.passed
          ? `任务 ${task.name} 第 ${round} 轮 review 通过 (avg ${score.average.toFixed(1)})`
          : `任务 ${task.name} 第 ${round} 轮 review 未通过 (avg ${score.average.toFixed(1)})`,
        atMs: 0,
      });

      if (score.passed) {
        passed = true;
        break;
      }
      feedbackForNext = [c.feedback, d.feedback];
    }

    return {
      taskName: task.name,
      subAgentName: task.subAgentName,
      output: lastOutput,
      wroteModules,
      reviews,
      passed,
      rounds,
    };
  }

  private async emit(ev: AutoModeProgressEvent): Promise<void> {
    for (const fn of this.listeners) {
      try {
        await fn(ev);
      } catch {
        // 忽略 listener 异常 —— 一个订阅者故障不应阻塞 orchestrator
      }
    }
  }
}

/** 帮助函数：构造默认 plan（阶段 11 demo —— 用于 UI 测试） */
export function buildDefaultAutoModePlan(projectId: import("@shared/types/ids.ts").ProjectId): TaskPlan {
  return {
    projectId,
    id: `plan-${Date.now()}`,
    tasks: [
      {
        name: "env_init",
        subAgentName: "auto_env_init",
        description: "创建项目元数据 + 工作区 + 客户联系人 / 团队成员",
        contextInputs: [],
      },
      {
        name: "business_requirements",
        subAgentName: "auto_business_req",
        description: "调查问卷 / 业务现状 / 问题点 / 改善目标",
        contextInputs: ["project_meta"],
      },
    ],
  };
}

/** LLM worker 的"胶水"：用 SubAgentRunner 调用实际 sub-agent。
 * 阶段 11 留接口 + stub；下个 sprint 完整实现。 */
export interface LLMAutoModeWorkerDeps {
  readonly runner: Pick<AutoModeWorker, never> & {
    /** invoke a sub-agent by name; placeholder for real LLM-backed invoke */
    invoke(name: import("@backend/domain/auto-mode/auto-mode.ts").SubAgentName, prompt: string): Promise<string>;
  };
}

/** 默认的 stub worker —— 返回固定文本，让骨架可单测 */
export function makeStubAutoModeWorker(opts?: { output?: string }): AutoModeWorker {
  const out = opts?.output ?? "[stub] worker output";
  return {
    async executeTask({ task }) {
      return { output: `${out} (${task.name})`, wroteModules: task.contextInputs.slice(0, 1) };
    },
  };
}

/** 默认 reviewer —— 返回固定分数（让评估协议可单测） */
export function makeStubReviewer(opts: {
  role: "customer" | "director";
  score?: number;
  feedback?: string;
}): Reviewer {
  const score = opts.score ?? 8;
  const feedback = opts.feedback ?? `[stub ${opts.role}] 改进建议`;
  return {
    role: opts.role,
    name: `${opts.role}-stub`,
    async review() {
      return { score, feedback };
    },
  };
}

/** 双 reviewer：第一个总是返高分（10），第二个总是返低分（5），测试不通过场景 */
export function makeMismatchedReviewers(opts?: {
  customerScore?: number;
  directorScore?: number;
}): { customer: Reviewer; director: Reviewer } {
  return {
    customer: makeStubReviewer({ role: "customer", score: opts?.customerScore ?? 10 }),
    director: makeStubReviewer({ role: "director", score: opts?.directorScore ?? 5 }),
  };
}