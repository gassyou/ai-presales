/**
 * ReviewItem —— 方案 Review 评估条目类型
 *
 * 阶段 7.4a。需求文档「18. 方案 Review 评估页面」：
 *   - 多维度评分（业务价值 / 技术可行性 / 成本合理性 / 实施风险 / 用户体验 等）
 *   - 总分（加权平均）
 *
 * payloadJson 存 { dimension, score, weight, comment }
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const REVIEW_KIND: BusinessModuleKind = "review";

export interface ReviewPayload {
  /** 评估维度（业务价值 / 技术可行性 / 成本合理性 / 实施风险 / 用户体验 / 安全性 等） */
  dimension: string;
  /** 0-10 整数 */
  score: number;
  /** 权重 0-1（默认 1.0） */
  weight: number;
  /** 评语 */
  comment: string;
}

export function makeReviewPayload(seed: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    dimension: seed.dimension ?? "",
    score: typeof seed.score === "number" ? seed.score : 0,
    weight: typeof seed.weight === "number" ? seed.weight : 1.0,
    comment: seed.comment ?? "",
  };
}

export function parseReviewPayload(json: string): ReviewPayload {
  try {
    const obj = JSON.parse(json) as Partial<ReviewPayload>;
    return makeReviewPayload(obj);
  } catch {
    return makeReviewPayload();
  }
}

/** 加权总分（按 weight 归一化） */
export function weightedScore(items: readonly ReviewPayload[]): number {
  if (items.length === 0) return 0;
  let total = 0;
  let sumWeights = 0;
  for (const it of items) {
    total += it.score * (it.weight > 0 ? it.weight : 1);
    sumWeights += it.weight > 0 ? it.weight : 1;
  }
  return sumWeights > 0 ? total / sumWeights : 0;
}
