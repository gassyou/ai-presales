/**
 * SurveyQuestionnaireUseCase —— 调查问卷专用用例
 *
 * 阶段 7.2。
 *   - getOutline(projectId)：返回该项目唯一的问卷大纲 item（不存在时返回 null）
 *   - saveOutline(projectId, mindmap)：创建或更新大纲
 *   - listQuestions(outlineId)：列出大纲下所有问题（按 ordinal asc）
 *   - upsertQuestion(parentId, ordinal, text, opts)
 *   - deleteQuestion(questionId)
 *   - batchFromMindmap(outlineId, generator)：按脑图节点生成初始问题（每节点一条占位问题）
 *   - saveAnswer(questionId, answer)
 *
 * 不变量：
 *   - 一个项目下 survey_questionnaire kind 只允许一个 parentId=null 的 item（唯一大纲）
 *   - 问题数量不设上限
 */

import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import type {
  BusinessModuleService,
  CreateItemInput,
  UpdateItemInput,
} from "./business-module.service.ts";
import type {
  BusinessModuleItemSnapshot,
} from "@backend/domain/business-module/business-module-item.ts";
import {
  flattenMindmap,
  isQuestionnaireOutlinePayload,
  makeOutlinePayload,
  makeQuestionPayload,
  SURVEY_QUESTIONNAIRE_KIND,
  type MindmapNode,
} from "@backend/domain/business-module/survey-questionnaire.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";

export interface OutlineDTO {
  id: string;
  projectId: string;
  mindmap: MindmapNode | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionDTO {
  id: string;
  parentId: string;
  ordinal: number;
  outlinePath?: string;
  title: string;
  answer?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyQuestionnaireUseCaseDeps {
  businessModuleService: BusinessModuleService;
  clock?: Clock;
  /** 阶段 7.5（H6）：可选注入 sub-agent 调用闭包；未注入时退化为「（占位问题）」fallback */
  invokeSubAgent?: (
    subAgentName: string,
    userInput: string,
    opts?: { signal?: AbortSignal },
  ) => AsyncIterable<StreamEvent>;
}

export class SurveyQuestionnaireUseCase {
  private readonly bm: BusinessModuleService;
  private readonly clock: Clock;
  /** 阶段 7.5（H6）：可选 sub-agent 调用闭包 */
  private readonly invokeSubAgent: SurveyQuestionnaireUseCaseDeps["invokeSubAgent"];

  constructor(deps: SurveyQuestionnaireUseCaseDeps) {
    this.bm = deps.businessModuleService;
    this.clock = deps.clock ?? new SystemClock();
    this.invokeSubAgent = deps.invokeSubAgent;
  }

  async getOutline(projectId: string): Promise<DomainResult<OutlineDTO | null>> {
    const items = await this.bm.listItems(projectId as never, SURVEY_QUESTIONNAIRE_KIND);
    const outlineSnap = items.find((i) => isQuestionnaireOutlinePayload(i.payloadJson).kind === "outline") ?? null;
    if (!outlineSnap) return domainOk(null);
    return domainOk(snapshotToOutline(outlineSnap));
  }

  async saveOutline(
    projectId: string,
    mindmap: MindmapNode | null,
  ): Promise<DomainResult<OutlineDTO>> {
    const existing = (await this.bm.listItems(projectId as never, SURVEY_QUESTIONNAIRE_KIND))
      .find((i) => isQuestionnaireOutlinePayload(i.payloadJson).kind === "outline");
    const payloadJson = JSON.stringify(makeOutlinePayload(mindmap));
    if (existing) {
      const r = await this.bm.updateItem(existing.id, { payloadJson });
      if (!r.ok) return r;
      return domainOk(snapshotToOutline(r.value));
    }
    const createInput: CreateItemInput = {
      title: "调查问卷大纲",
      content: "",
      payloadJson,
    };
    const r = await this.bm.createItem(projectId as never, SURVEY_QUESTIONNAIRE_KIND, createInput);
    if (!r.ok) return r;
    return domainOk(snapshotToOutline(r.value));
  }

  async listQuestions(outlineId: string): Promise<DomainResult<QuestionDTO[]>> {
    const outline = await this.bm.getItem(outlineId);
    if (!outline.ok) return outline;
    if (isQuestionnaireOutlinePayload(outline.value.payloadJson).kind !== "outline") {
      return domainErr("NOT_FOUND", "outline not found");
    }
    const all = await this.bm.listItems(outline.value.projectId, SURVEY_QUESTIONNAIRE_KIND);
    const qs = all
      .filter((i) => {
        const p = isQuestionnaireOutlinePayload(i.payloadJson);
        return p.kind === "question";
      })
      .map((i) => snapshotToQuestion(i))
      .sort((a, b) => a.ordinal - b.ordinal);
    return domainOk(qs);
  }

  async upsertQuestionInProject(
    projectId: string,
    args: {
      parentId: string;
      ordinal: number;
      title: string;
      outlinePath?: string;
      answer?: string;
      questionId?: string;
    },
  ): Promise<DomainResult<QuestionDTO>> {
    const title = args.title.trim();
    if (!title) return domainErr("INVALID_INPUT", "question title is required");
    const payload = makeQuestionPayload(args.parentId, args.ordinal, {
      outlinePath: args.outlinePath,
      answer: args.answer,
    });
    const payloadJson = JSON.stringify(payload);

    if (args.questionId) {
      const r = await this.bm.updateItem(args.questionId, {
        title,
        content: title,
        payloadJson,
      });
      if (!r.ok) return r;
      return domainOk(snapshotToQuestion(r.value));
    }
    const r = await this.bm.createItem(projectId as never, SURVEY_QUESTIONNAIRE_KIND, {
      title,
      content: title,
      payloadJson,
    });
    if (!r.ok) return r;
    return domainOk(snapshotToQuestion(r.value));
  }

  async deleteQuestion(questionId: string): Promise<DomainResult<void>> {
    return await this.bm.deleteItem(questionId);
  }

  /**
   * 从脑图节点生成初始问题（阶段 7.5/H6 改造）
   *
   * - invokeSubAgent 已注入 → 每节点调 LLM 生成 1 条问题正文；失败时 fallback 到「（占位问题）」前缀
   * - 未注入 → 沿用旧 fallback（dev/测试不破）
   * - signal 中断时立刻停止后续节点（短路返回）
   */
  async batchFromMindmap(
    outlineId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<DomainResult<QuestionDTO[]>> {
    const outline = await this.bm.getItem(outlineId);
    if (!outline.ok) return outline;
    const payload = isQuestionnaireOutlinePayload(outline.value.payloadJson);
    if (payload.kind !== "outline") return domainErr("NOT_FOUND", "outline not found");
    const projectId = outline.value.projectId;
    const flat = flattenMindmap(payload.mindmap);
    if (flat.length === 0) return domainOk([]);

    const out: QuestionDTO[] = [];
    let ordinal = 0;
    for (const { path } of flat) {
      if (opts?.signal?.aborted) {
        return domainErr("ABORTED", "batchFromMindmap aborted");
      }
      const title = await this.rewriteNodeToQuestion(path, opts?.signal);
      const r = await this.upsertQuestionInProject(projectId, {
        parentId: outlineId,
        ordinal,
        title,
        outlinePath: path,
      });
      if (!r.ok) return r;
      out.push(r.value);
      ordinal++;
    }
    return domainOk(out);
  }

  /**
   * 阶段 7.5（H6）内部辅助：把脑图节点路径改写成一条调查问题
   * - invokeSubAgent 已注入 → 调 markdown-author（每节点独立一条流）
   * - 未注入 / 失败 / 拒空 → fallback 到「（占位问题）${path}」
   */
  private async rewriteNodeToQuestion(path: string, signal?: AbortSignal): Promise<string> {
    if (!this.invokeSubAgent) {
      return `（占位问题）${path}`;
    }
    try {
      const prompt = `请把以下脑图节点路径改写成一条简洁的调查问题（一句话、问号结尾）。
要求：
- 直接输出问题正文，不要「问题：」前缀 / 不要 JSON / 不要元注释
- 若路径较长可拆分成 1~3 个相关问题，用「\n」分隔
- 不要杜撰具体数据；信息不足时直接保留路径作为问题

路径：${path}`;
      const raw = await collectStreamToString(this.invokeSubAgent("markdown-author", prompt, { signal }), signal);
      const cleaned = raw.trim();
      return cleaned.length > 0 ? cleaned : `（占位问题）${path}`;
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") throw e;
      return `（占位问题）${path}`;
    }
  }

  /** 保存单条回答 */
  async saveAnswer(questionId: string, answer: string): Promise<DomainResult<QuestionDTO>> {
    const cur = await this.bm.getItem(questionId);
    if (!cur.ok) return cur;
    const p = isQuestionnaireOutlinePayload(cur.value.payloadJson);
    if (p.kind !== "question") return domainErr("NOT_FOUND", "question not found");
    const existingPayload = JSON.parse(cur.value.payloadJson) as { parentId: string; ordinal: number; outlinePath?: string; answer?: string };
    const next = makeQuestionPayload(existingPayload.parentId, existingPayload.ordinal, {
      outlinePath: existingPayload.outlinePath,
      answer,
    });
    const r = await this.bm.updateItem(questionId, { payloadJson: JSON.stringify(next) });
    if (!r.ok) return r;
    return domainOk(snapshotToQuestion(r.value));
  }
}

function snapshotToOutline(snap: BusinessModuleItemSnapshot): OutlineDTO {
  const p = isQuestionnaireOutlinePayload(snap.payloadJson);
  const mindmap = p.kind === "outline" ? p.mindmap : null;
  return {
    id: snap.id,
    projectId: snap.projectId,
    mindmap,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

function snapshotToQuestion(snap: BusinessModuleItemSnapshot): QuestionDTO {
  let parentId = "";
  let ordinal = 0;
  let outlinePath: string | undefined;
  let answer: string | undefined;
  try {
    const p = JSON.parse(snap.payloadJson) as Partial<{
      parentId: string;
      ordinal: number;
      outlinePath: string;
      answer: string;
    }>;
    parentId = p.parentId ?? "";
    ordinal = p.ordinal ?? 0;
    outlinePath = p.outlinePath;
    answer = p.answer;
  } catch {
    // ignore
  }
  return {
    id: snap.id,
    parentId,
    ordinal,
    outlinePath,
    title: snap.content || snap.title,
    answer,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}
