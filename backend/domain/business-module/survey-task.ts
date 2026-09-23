/**
 * SurveyTask —— 调查任务专用类型
 *
 * 阶段 7.1。需求文档「2. 调查任务页面」：
 *   - 任务有独立生命周期（运行中 / 已完成 / 已终止）
 *   - 调查结果（markdown）
 *   - 采用 / 不采用 状态
 *
 * 设计：
 *   - 任务本身存 `business_module_items` 表（kind="survey_task"）
 *   - status 字段 = 调查结果采纳状态（pending / adopted / unadopted）
 *   - payload_json 字段 = { taskStatus, topicHint, startedAt, completedAt, error }
 *   - content 字段 = 调查结果 markdown 文本
 *
 * 这样：通用 BusinessModuleService 直接覆盖 list / get / adopt / unadopt；
 * 只在应用层加 start / stop / poll 等专用 use case。
 */

import type { BusinessModuleKind } from "./business-module.ts";

export type SurveyTaskStatus = "idle" | "running" | "completed" | "aborted";

export interface SurveyTaskPayload {
  /** 任务运行状态（独立于"调查结果采纳状态"） */
  taskStatus: SurveyTaskStatus;
  /** 调查主题提示（自由文本，比如"客户背景信息 / 行业背景"） */
  topicHint?: string;
  /** 开始时间 ISO */
  startedAt?: string;
  /** 完成时间 ISO */
  completedAt?: string;
  /** 终止时记录的 reason */
  error?: string;
  /** 调查主题示例（来自需求文档） */
  exampleTopics?: readonly string[];
}

export const SURVEY_TASK_EXAMPLES: readonly string[] = [
  "客户背景信息（人数，年度营业额，组织架构，主营业务等等）",
  "行业背景信息",
  "专业术语",
  "市场上现有的方案",
  "相关领域相关论文",
  "最新的前沿技术",
];

export const SURVEY_TASK_KIND: BusinessModuleKind = "survey_task";

export function makeSurveyTaskPayload(seed?: Partial<SurveyTaskPayload>): SurveyTaskPayload {
  return {
    taskStatus: "idle",
    ...seed,
  };
}

export function parseSurveyTaskPayload(json: string): SurveyTaskPayload {
  try {
    const obj = JSON.parse(json) as Partial<SurveyTaskPayload>;
    return {
      taskStatus: obj.taskStatus ?? "idle",
      topicHint: obj.topicHint,
      startedAt: obj.startedAt,
      completedAt: obj.completedAt,
      error: obj.error,
      exampleTopics: obj.exampleTopics,
    };
  } catch {
    return { taskStatus: "idle" };
  }
}

export function isSurveyTaskKind(kind: BusinessModuleKind): boolean {
  return kind === "survey_task";
}
