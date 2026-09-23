/**
 * SurveyQuestionnaire —— 调查问卷专用类型
 *
 * 阶段 7.2。结构：
 *   - 大纲脑图：survey_questionnaire kind 下 `parentId=null` 的 item，payloadJson.mindmap = { id, text, children }
 *   - 问题条目：survey_questionnaire kind 下 `parentId=<大纲 id>` 的 item，content=问题文本
 *   - 回答：单独维护（每用户/整体问卷的回答暂存 payloadJson.answer）
 *
 * 设计：
 *   - 复用 7.0 BusinessModuleItem；parentId 是约定字段，存 payloadJson.parentId
 *   - 同一 kind 共存"大纲 + 问题"两类 item，通过 parentId 区分
 *   - "按大纲分组"：列问题时 groupBy(parentId)
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const SURVEY_QUESTIONNAIRE_KIND: BusinessModuleKind = "survey_questionnaire";

/** 脑图节点：纯 JSON，可序列化 */
export interface MindmapNode {
  id: string;
  text: string;
  children: MindmapNode[];
}

export interface QuestionnaireOutlinePayload {
  /** 顶层脑图（根节点）；无节点时为 null */
  mindmap: MindmapNode | null;
}

export interface QuestionnaireQuestionPayload {
  parentId: string;            // 关联到的大纲 item id
  /** 原始大纲节点路径（人类可读） */
  outlinePath?: string;
  /** 回答（用户填写） */
  answer?: string;
  /** 问题顺序（在同一 parentId 下从 0 开始） */
  ordinal: number;
}

export function isQuestionnaireOutlinePayload(
  json: string,
): { kind: "outline"; mindmap: MindmapNode | null } | { kind: "question" } {
  try {
    const obj = JSON.parse(json) as { parentId?: unknown; mindmap?: unknown };
    if (obj.mindmap !== undefined) {
      return { kind: "outline", mindmap: (obj.mindmap as MindmapNode | null) ?? null };
    }
    if (typeof obj.parentId === "string") {
      return { kind: "question" };
    }
    return { kind: "outline", mindmap: null };
  } catch {
    return { kind: "outline", mindmap: null };
  }
}

export function makeOutlinePayload(mindmap: MindmapNode | null): QuestionnaireOutlinePayload {
  return { mindmap };
}

export function makeQuestionPayload(
  parentId: string,
  ordinal: number,
  opts?: { outlinePath?: string; answer?: string },
): QuestionnaireQuestionPayload {
  return {
    parentId,
    ordinal,
    ...(opts?.outlinePath !== undefined ? { outlinePath: opts.outlinePath } : {}),
    ...(opts?.answer !== undefined ? { answer: opts.answer } : {}),
  };
}

/** 把脑图展平成"路径 → 节点"数组；用于 AI 生成问题 */
export function flattenMindmap(node: MindmapNode | null): Array<{ path: string; node: MindmapNode }> {
  if (!node) return [];
  const out: Array<{ path: string; node: MindmapNode }> = [];
  const walk = (n: MindmapNode, pathParts: string[]): void => {
    const path = [...pathParts, n.text].join(" / ");
    out.push({ path, node: n });
    for (const c of n.children) walk(c, [...pathParts, n.text]);
  };
  walk(node, []);
  return out;
}

/** 计算节点路径 */
export function nodePath(root: MindmapNode | null, id: string): string | null {
  const found = flattenMindmap(root).find((x) => x.node.id === id);
  return found ? found.path : null;
}
