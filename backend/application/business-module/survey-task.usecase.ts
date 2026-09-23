/**
 * SurveyTaskUseCase —— 调查任务专用编排
 *
 * 阶段 7.1。覆盖需求文档「2. 调查任务页面」1、6、7：
 *   - startSurveyTask：异步执行（H3 修复后调 survey-researcher sub-agent；未注入时退化为 setTimeout 占位）
 *   - stopSurveyTask：终止（标记 aborted）
 *   - getSurveyTask：返回任务快照（含 taskStatus）
 *
 * 设计：
 *   - 复用 BusinessModuleService 做 CRUD；本类只管 taskStatus 生命周期 + 结果内容
 *   - 任务执行走 background promise；进程内 Map<taskId, AbortController> 管理终止
 *   - invokeSubAgent 可选注入：注入则真调 LLM，未注入则保留占位（向后兼容 dev/测试）
 */

import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import type { BusinessModuleService } from "./business-module.service.ts";
import type {
  BusinessModuleItemSnapshot,
} from "@backend/domain/business-module/business-module-item.ts";
import {
  makeSurveyTaskPayload,
  parseSurveyTaskPayload,
  SURVEY_TASK_KIND,
  type SurveyTaskPayload,
  type SurveyTaskStatus,
} from "@backend/domain/business-module/survey-task.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";

export interface SurveyTaskResult {
  id: string;
  projectId: string;
  title: string;
  taskStatus: SurveyTaskStatus;
  resultContent: string;
  adoptionStatus: "pending" | "adopted" | "unadopted";
  topicHint?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 阶段 7.5（H3）：可选注入 sub-agent 调用闭包；未注入时 execute() 退化为 setTimeout 占位 */
export type InvokeSubAgentFn = (
  subAgentName: string,
  userInput: string,
  opts?: { signal?: AbortSignal },
) => AsyncIterable<StreamEvent>;

export interface SurveyTaskUseCaseDeps {
  businessModuleService: BusinessModuleService;
  clock?: Clock;
  /** 任务模拟执行时间（ms），默认 800ms（测试可调小；仅占位路径生效） */
  simulateDurationMs?: number;
  /** 阶段 7.5（H3）：注入后真调 LLM；未注入走占位 fallback */
  invokeSubAgent?: InvokeSubAgentFn;
}

function snapshotToResult(snap: BusinessModuleItemSnapshot): SurveyTaskResult {
  const payload = parseSurveyTaskPayload(snap.payloadJson);
  return {
    id: snap.id,
    projectId: snap.projectId,
    title: snap.title,
    taskStatus: payload.taskStatus,
    resultContent: snap.content,
    adoptionStatus: snap.status,
    topicHint: payload.topicHint,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    error: payload.error,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

export class SurveyTaskUseCase {
  private readonly bm: BusinessModuleService;
  private readonly clock: Clock;
  private readonly simulateDurationMs: number;
  /** 阶段 7.5（H3）：可选 sub-agent 调用闭包 */
  private readonly invokeSubAgent: InvokeSubAgentFn | undefined;
  /** 进行中的任务：taskId -> AbortController */
  private readonly inflight = new Map<string, AbortController>();

  constructor(deps: SurveyTaskUseCaseDeps) {
    this.bm = deps.businessModuleService;
    this.clock = deps.clock ?? new SystemClock();
    this.simulateDurationMs = deps.simulateDurationMs ?? 800;
    this.invokeSubAgent = deps.invokeSubAgent;
  }

  /** 列出某项目下所有调查任务 */
  async list(projectId: string): Promise<SurveyTaskResult[]> {
    const items = await this.bm.listItems(projectId as never, SURVEY_TASK_KIND);
    return items.map(snapshotToResult);
  }

  /** 查单条 */
  async get(taskId: string): Promise<DomainResult<SurveyTaskResult>> {
    const r = await this.bm.getItem(taskId);
    if (!r.ok) return r;
    return domainOk(snapshotToResult(r.value));
  }

  /** 新建调查任务（任务名 + 调查内容；初始 taskStatus=idle） */
  async create(
    projectId: string,
    title: string,
    detail: string,
    opts?: { topicHint?: string },
  ): Promise<DomainResult<SurveyTaskResult>> {
    if (!title.trim()) return domainErr("INVALID_INPUT", "title is required");
    const payload = makeSurveyTaskPayload({ topicHint: opts?.topicHint });
    const r = await this.bm.createItem(projectId as never, SURVEY_TASK_KIND, {
      title: title.trim(),
      content: detail,
      payloadJson: JSON.stringify(payload),
    });
    if (!r.ok) return r;
    return domainOk(snapshotToResult(r.value));
  }

  /** 删除调查任务 + 取消进行中的执行 */
  async delete(taskId: string): Promise<DomainResult<void>> {
    const inflightCtrl = this.inflight.get(taskId);
    if (inflightCtrl) {
      inflightCtrl.abort();
      this.inflight.delete(taskId);
    }
    return await this.bm.deleteItem(taskId);
  }

  /** 异步执行任务（模拟 AI 调查） */
  async start(taskId: string): Promise<DomainResult<SurveyTaskResult>> {
    const found = await this.bm.getItem(taskId);
    if (!found.ok) return found;
    const snap = found.value;
    const payload = parseSurveyTaskPayload(snap.payloadJson);
    if (payload.taskStatus === "running") {
      return domainErr("ILLEGAL_STATE_TRANSITION", "task is already running");
    }
    const ctrl = new AbortController();
    this.inflight.set(taskId, ctrl);

    const startedAt = new Date().toISOString();
    const next: SurveyTaskPayload = {
      ...payload,
      taskStatus: "running",
      startedAt,
      error: undefined,
    };
    await this.bm.updateItem(taskId, {
      payloadJson: JSON.stringify(next),
    });

    // fire-and-forget 后台执行；通过 Promise 串 ctrl.signal 让 stop() 可以 abort
    void this.execute(taskId, ctrl.signal);

    const after = await this.bm.getItem(taskId);
    if (!after.ok) return after;
    return domainOk(snapshotToResult(after.value));
  }

  /** 终止任务 */
  async stop(taskId: string): Promise<DomainResult<SurveyTaskResult>> {
    const ctrl = this.inflight.get(taskId);
    if (!ctrl) {
      // 不在运行中也允许 stop（no-op 状态切换）；返回最新
      const snap = await this.bm.getItem(taskId);
      if (!snap.ok) return snap;
      return domainOk(snapshotToResult(snap.value));
    }
    ctrl.abort();
    this.inflight.delete(taskId);
    const snap = await this.bm.getItem(taskId);
    if (!snap.ok) return snap;
    const payload = parseSurveyTaskPayload(snap.value.payloadJson);
    const next: SurveyTaskPayload = {
      ...payload,
      taskStatus: "aborted",
      completedAt: new Date().toISOString(),
      error: "user aborted",
    };
    const upd = await this.bm.updateItem(taskId, {
      payloadJson: JSON.stringify(next),
    });
    if (!upd.ok) return upd;
    return domainOk(snapshotToResult(upd.value));
  }

  /** AI 一键批量生成调查任务（基于项目现有信息批量创建 idle 任务；阶段 7.5/H2 加 autoStart） */
  async batchGenerate(
    projectId: string,
    topics: readonly string[],
    opts?: { autoStart?: boolean },
  ): Promise<DomainResult<SurveyTaskResult[]>> {
    if (topics.length === 0) return domainErr("INVALID_INPUT", "topics must not be empty");
    const autoStart = opts?.autoStart ?? true;
    const out: SurveyTaskResult[] = [];
    for (const t of topics) {
      const r = await this.create(projectId, t, "");
      if (!r.ok) return r;
      out.push(r.value);
    }
    if (autoStart) {
      // 阶段 7.5（H2）：批量创建后立刻启动每个 task（fire-and-forget，并行；start 内部已经 fire-and-forget）
      await Promise.all(out.map((item) => this.start(item.id)));
    }
    return domainOk(out);
  }

  // ---------- private ----------

  private async execute(taskId: string, signal: AbortSignal): Promise<void> {
    const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      const snap = await this.bm.getItem(taskId);
      if (!snap.ok) return;
      const payload = parseSurveyTaskPayload(snap.value.payloadJson);
      const topicHint = payload.topicHint ?? snap.value.title;

      let resultContent: string;
      if (this.invokeSubAgent) {
        // 阶段 7.5（H3）：真调 survey-researcher sub-agent
        const prompt = `请围绕以下调研主题撰写一份调查计划与要点 markdown（500~1500 字）。
主题：${snap.value.title}
方向：${topicHint}

要求：
- 输出 Markdown 格式，分「背景」「调查目标」「关键问题」「建议访谈对象」「预期产出」5 节
- 不要输出 JSON / 元注释
- 直接给出章节正文`;
        try {
          resultContent = await collectStreamToString(
            this.invokeSubAgent("survey-researcher", prompt, { signal }),
            signal,
          );
        } catch (e) {
          if ((e as { name?: string })?.name === "AbortError") throw e;
          // LLM 失败时降级到占位（不阻塞任务完成）
          resultContent = snap.value.content && snap.value.content.trim().length > 0
            ? snap.value.content
            : `# 调查：${snap.value.title}\n\n主题：${topicHint}\n\n（AI 生成失败：${e instanceof Error ? e.message : String(e)}）\n`;
        }
      } else {
        // 旧占位路径（dev/测试 fallback）
        await sleep(this.simulateDurationMs);
        resultContent = snap.value.content && snap.value.content.trim().length > 0
          ? snap.value.content
          : `# 调查：${snap.value.title}\n\n主题：${topicHint}\n\n（本结果由本地占位逻辑生成，后续阶段接入 survey-researcher sub-agent）\n`;
      }

      await this.bm.updateItem(taskId, {
        content: resultContent,
        payloadJson: JSON.stringify({
          ...payload,
          taskStatus: "completed",
          completedAt: new Date().toISOString(),
        } satisfies SurveyTaskPayload),
      });
    } catch (e) {
      // abort 或异常：仅在非已 aborted 状态下覆盖
      const cur = await this.bm.getItem(taskId);
      if (!cur.ok) return;
      const payload = parseSurveyTaskPayload(cur.value.payloadJson);
      if (payload.taskStatus === "aborted") return; // 已被 stop 标记
      const next: SurveyTaskPayload = {
        ...payload,
        taskStatus: "aborted",
        completedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
      await this.bm.updateItem(taskId, {
        payloadJson: JSON.stringify(next),
      });
    } finally {
      this.inflight.delete(taskId);
    }
  }
}
