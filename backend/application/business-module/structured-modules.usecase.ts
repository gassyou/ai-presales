/**
 * StructuredModulesUseCase —— 用例 / 交付物 / Review / 功能清单 / 预算设置 / 预算汇总
 *
 * 阶段 7.4a + 7.4b。每个 kind 共用 create / list / update / delete 逻辑；payload 字段按 kind 区分。
 * 预算汇总（budget_summary）为派生视图，**不存库**——只读 GET 即时计算。
 */

import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import type { BusinessModuleService } from "./business-module.service.ts";
import type {
  BusinessModuleItemSnapshot,
} from "@backend/domain/business-module/business-module-item.ts";
import {
  USE_CASE_KIND,
  makeUseCasePayload,
  parseUseCasePayload,
  type UseCasePayload,
} from "@backend/domain/business-module/use-case.ts";
import {
  DELIVERABLE_KIND,
  makeDeliverablePayload,
  parseDeliverablePayload,
  type DeliverablePayload,
  type DeliverableStatus,
} from "@backend/domain/business-module/deliverable.ts";
import {
  REVIEW_KIND,
  makeReviewPayload,
  parseReviewPayload,
  weightedScore,
  type ReviewPayload,
} from "@backend/domain/business-module/review.ts";
import {
  FUNCTION_LIST_KIND,
  CP_VALUES,
  inScopeFunctions,
  isValidCP,
  makeFunctionListPayload,
  makeFunctionTitle,
  parseFunctionListPayload,
  type CPValue,
  type FunctionListPayload,
} from "@backend/domain/business-module/function-list.ts";
import {
  BUDGET_SETTINGS_KIND,
  DEFAULT_BUDGET_SETTINGS,
  makeBudgetSettingsPayload,
  parseBudgetSettingsPayload,
  validateBudgetSettings,
  type BudgetSettingsPayload,
} from "@backend/domain/business-module/budget-settings.ts";
import {
  computeFunctionAmount,
  computeFunctionEffortHours,
  computeBudgetSummary,
  type BudgetSummary,
} from "@backend/domain/business-module/budget-summary.ts";

export interface UseCaseResult {
  id: string;
  projectId: string;
  title: string;
  detail: string;
  caseId: string;
  businessRules: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliverableResult {
  id: string;
  projectId: string;
  title: string;
  type: string;
  owner?: string;
  dueDate?: string;
  status: DeliverableStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewResult {
  id: string;
  projectId: string;
  title: string;
  dimension: string;
  score: number;
  weight: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  totalScore: number;
  itemCount: number;
}

// ---------- FunctionList ----------
export interface FunctionListResult {
  id: string;
  projectId: string;
  title: string;
  category: string;
  module: string;
  name: string;
  detail: string;
  remarks: string;
  cp: CPValue | 0;
  inScope: boolean;
  /** 派生：工时（小时） */
  effortHours: number;
  /** 派生：金额（元） */
  amount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------- BudgetSettings ----------
export interface BudgetSettingsResult extends BudgetSettingsPayload {}

// ---------- BudgetSummary ----------
export type { BudgetSummary };

import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";

/** 阶段 7.5（H1）：可选注入 sub-agent 调用闭包；未注入时 batchFromSubAgent 返回空 */
export type InvokeSubAgentFn = (
  subAgentName: string,
  userInput: string,
  opts?: { signal?: AbortSignal },
) => AsyncIterable<StreamEvent>;

export interface StructuredModulesUseCaseDeps {
  bm: BusinessModuleService;
  /** 阶段 7.5（H1）：真调 LLM 生成功能列表；未注入 → 抛 NOT_IMPLEMENTED */
  invokeSubAgent?: InvokeSubAgentFn;
  /** 阶段 7.5（H1）：可选项目元信息（注入 prompt 上下文） */
  getProjectMeta?: (projectId: never) => Promise<{ name: string; clientName: string } | null>;
}

export interface BatchFromSubAgentInput {
  prompt?: string;
  count?: number;
}

export interface CreateFunctionListInput {
  category?: string;
  module?: string;
  name?: string;
  detail?: string;
  remarks?: string;
  cp?: number;
  inScope?: boolean;
}

export interface BatchFromSubAgentOutput {
  created: FunctionListResult[];
}

export class StructuredModulesUseCase {
  private readonly bm: BusinessModuleService;
  /** 阶段 7.5（H1） */
  private readonly invokeSubAgent: InvokeSubAgentFn | undefined;
  /** 阶段 7.5（H1） */
  private readonly getProjectMeta: ((projectId: never) => Promise<{ name: string; clientName: string } | null>) | undefined;

  constructor(deps: StructuredModulesUseCaseDeps | BusinessModuleService) {
    if ("bm" in deps) {
      this.bm = deps.bm;
      this.invokeSubAgent = deps.invokeSubAgent;
      this.getProjectMeta = deps.getProjectMeta;
    } else {
      // 向后兼容：传 BusinessModuleService 直接构造（旧用法）
      this.bm = deps;
      this.invokeSubAgent = undefined;
      this.getProjectMeta = undefined;
    }
  }

  // ---------- UseCase ----------

  async listUseCases(projectId: string): Promise<UseCaseResult[]> {
    const items = await this.bm.listItems(projectId as never, USE_CASE_KIND);
    return items.map(snapToUseCase);
  }

  async createUseCase(
    projectId: string,
    input: { title: string; detail?: string; caseId?: string; businessRules?: string },
  ): Promise<DomainResult<UseCaseResult>> {
    if (!input.title.trim()) return domainErr("INVALID_INPUT", "title is required");
    const payload = makeUseCasePayload({ caseId: input.caseId ?? "", businessRules: input.businessRules ?? "" });
    const r = await this.bm.createItem(projectId as never, USE_CASE_KIND, {
      title: input.title,
      content: input.detail ?? "",
      payloadJson: JSON.stringify(payload),
    });
    if (!r.ok) return r;
    return domainOk(snapToUseCase(r.value));
  }

  async updateUseCase(
    id: string,
    input: { title?: string; detail?: string; caseId?: string; businessRules?: string },
  ): Promise<DomainResult<UseCaseResult>> {
    const existing = await this.bm.getItem(id);
    if (!existing.ok) return existing;
    const cur = parseUseCasePayload(existing.value.payloadJson);
    const next: UseCasePayload = {
      caseId: input.caseId ?? cur.caseId,
      businessRules: input.businessRules ?? cur.businessRules,
    };
    const r = await this.bm.updateItem(id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.detail !== undefined ? { content: input.detail } : {}),
      payloadJson: JSON.stringify(next),
    });
    if (!r.ok) return r;
    return domainOk(snapToUseCase(r.value));
  }

  async deleteUseCase(id: string): Promise<DomainResult<void>> {
    return await this.bm.deleteItem(id);
  }

  // ---------- Deliverable ----------

  async listDeliverables(projectId: string): Promise<DeliverableResult[]> {
    const items = await this.bm.listItems(projectId as never, DELIVERABLE_KIND);
    return items.map(snapToDeliverable);
  }

  async createDeliverable(
    projectId: string,
    input: { title: string; type?: string; owner?: string; dueDate?: string; status?: DeliverableStatus },
  ): Promise<DomainResult<DeliverableResult>> {
    if (!input.title.trim()) return domainErr("INVALID_INPUT", "title is required");
    const payload = makeDeliverablePayload({
      type: input.type,
      owner: input.owner,
      dueDate: input.dueDate,
      status: input.status,
    });
    const r = await this.bm.createItem(projectId as never, DELIVERABLE_KIND, {
      title: input.title,
      content: "",
      payloadJson: JSON.stringify(payload),
    });
    if (!r.ok) return r;
    return domainOk(snapToDeliverable(r.value));
  }

  async updateDeliverable(
    id: string,
    input: { title?: string; type?: string; owner?: string; dueDate?: string; status?: DeliverableStatus },
  ): Promise<DomainResult<DeliverableResult>> {
    const existing = await this.bm.getItem(id);
    if (!existing.ok) return existing;
    const cur = parseDeliverablePayload(existing.value.payloadJson);
    const next: DeliverablePayload = {
      type: input.type ?? cur.type,
      status: input.status ?? cur.status,
      ...(input.owner !== undefined ? { owner: input.owner } : cur.owner !== undefined ? { owner: cur.owner } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : cur.dueDate !== undefined ? { dueDate: cur.dueDate } : {}),
    };
    const r = await this.bm.updateItem(id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      payloadJson: JSON.stringify(next),
    });
    if (!r.ok) return r;
    return domainOk(snapToDeliverable(r.value));
  }

  async deleteDeliverable(id: string): Promise<DomainResult<void>> {
    return await this.bm.deleteItem(id);
  }

  // ---------- Review ----------

  async listReviews(projectId: string): Promise<ReviewResult[]> {
    const items = await this.bm.listItems(projectId as never, REVIEW_KIND);
    return items.map(snapToReview);
  }

  async createReview(
    projectId: string,
    input: { title: string; dimension: string; score?: number; weight?: number; comment?: string },
  ): Promise<DomainResult<ReviewResult>> {
    if (!input.title.trim()) return domainErr("INVALID_INPUT", "title is required");
    if (!input.dimension.trim()) return domainErr("INVALID_INPUT", "dimension is required");
    const payload = makeReviewPayload({
      dimension: input.dimension,
      score: input.score,
      weight: input.weight,
      comment: input.comment,
    });
    const r = await this.bm.createItem(projectId as never, REVIEW_KIND, {
      title: input.title,
      content: "",
      payloadJson: JSON.stringify(payload),
    });
    if (!r.ok) return r;
    return domainOk(snapToReview(r.value));
  }

  async updateReview(
    id: string,
    input: { title?: string; dimension?: string; score?: number; weight?: number; comment?: string },
  ): Promise<DomainResult<ReviewResult>> {
    const existing = await this.bm.getItem(id);
    if (!existing.ok) return existing;
    const cur = parseReviewPayload(existing.value.payloadJson);
    const next: ReviewPayload = {
      dimension: input.dimension ?? cur.dimension,
      score: input.score ?? cur.score,
      weight: input.weight ?? cur.weight,
      comment: input.comment ?? cur.comment,
    };
    const r = await this.bm.updateItem(id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      payloadJson: JSON.stringify(next),
    });
    if (!r.ok) return r;
    return domainOk(snapToReview(r.value));
  }

  async deleteReview(id: string): Promise<DomainResult<void>> {
    return await this.bm.deleteItem(id);
  }

  async reviewSummary(projectId: string): Promise<DomainResult<ReviewSummary>> {
    const items = await this.listReviews(projectId);
    const totalScore = weightedScore(items.map((it) => parseReviewPayload(
      JSON.stringify({
        dimension: it.dimension,
        score: it.score,
        weight: it.weight,
        comment: it.comment,
      }),
    )));
    return domainOk({ totalScore, itemCount: items.length });
  }

  // ============================================================
  // 阶段 7.4b：功能清单 / 预算设置 / 预算汇总
  // ============================================================

  // ---------- FunctionList ----------

  async listFunctions(projectId: string): Promise<FunctionListResult[]> {
    const items = await this.bm.listItems(projectId as never, FUNCTION_LIST_KIND);
    const settings = await this.getBudgetSettings(projectId);
    return items.map((snap) => snapToFunction(snap, settings));
  }

  async createFunction(
    projectId: string,
    input: CreateFunctionListInput,
  ): Promise<DomainResult<FunctionListResult>> {
    if (!input.name || !input.name.trim()) {
      return domainErr("INVALID_INPUT", "功能名 (name) 不能为空");
    }
    const cp = input.cp ?? 0;
    if (cp !== 0 && !isValidCP(cp)) {
      return domainErr("INVALID_INPUT", `CP 值必须是 ${CP_VALUES.join(",")} 之一或 0`);
    }
    const payload = makeFunctionListPayload({
      category: input.category,
      module: input.module,
      name: input.name,
      detail: input.detail,
      remarks: input.remarks,
      cp,
      inScope: input.inScope ?? true,
    });
    const inScope = payload.inScope;
    const r = await this.bm.createItem(projectId as never, FUNCTION_LIST_KIND, {
      title: makeFunctionTitle(payload),
      content: "",
      payloadJson: JSON.stringify(payload),
      // inScope=false → 自动设 unadopted（让 AI 上下文排除）
      initialStatus: inScope ? "pending" : "unadopted",
    });
    if (!r.ok) return r;
    const settings = await this.getBudgetSettings(projectId);
    return domainOk(snapToFunction(r.value, settings));
  }

  async updateFunction(
    _projectId: string,
    id: string,
    input: {
      category?: string;
      module?: string;
      name?: string;
      detail?: string;
      remarks?: string;
      cp?: number;
      inScope?: boolean;
    },
  ): Promise<DomainResult<FunctionListResult>> {
    const existing = await this.bm.getItem(id);
    if (!existing.ok) return existing;
    const cur = parseFunctionListPayload(existing.value.payloadJson);
    const cpRaw = input.cp !== undefined ? input.cp : cur.cp;
    if (cpRaw !== 0 && !isValidCP(cpRaw)) {
      return domainErr("INVALID_INPUT", `CP 值必须是 ${CP_VALUES.join(",")} 之一或 0`);
    }
    const next: FunctionListPayload = {
      category: input.category ?? cur.category,
      module: input.module ?? cur.module,
      name: input.name ?? cur.name,
      detail: input.detail ?? cur.detail,
      remarks: input.remarks ?? cur.remarks,
      cp: cpRaw,
      inScope: input.inScope ?? cur.inScope,
    };
    // 同步 status：inScope=false → unadopted；inScope=true → 若原状态 unadopted 改回 pending
    let status: "pending" | "adopted" | "unadopted" | undefined;
    if (input.inScope !== undefined && input.inScope !== cur.inScope) {
      if (next.inScope) {
        status = existing.value.status === "unadopted" ? "pending" : existing.value.status;
      } else {
        status = "unadopted";
      }
    }

    const r = await this.bm.updateItem(id, {
      title: makeFunctionTitle(next),
      payloadJson: JSON.stringify(next),
      ...(status ? { status } : {}),
    });
    if (!r.ok) return r;
    const settings = await this.getBudgetSettings(_projectId);
    return domainOk(snapToFunction(r.value, settings));
  }

  async deleteFunction(id: string): Promise<DomainResult<void>> {
    return await this.bm.deleteItem(id);
  }

  /**
   * 阶段 7.5（H1）：AI 一键生成功能列表
   * - 调 markdown-author；要求 sub-agent 输出严格 JSON（数组，每项 { category, module, name, cp?, inScope?, detail? }）
   * - JSON 解析失败 → 回退 N 个空 placeholder 行（保证 UI 不阻塞）
   * - signal 中断 → 抛 AbortError
   */
  async batchFromSubAgent(
    projectId: string,
    input: BatchFromSubAgentInput = {},
    opts?: { signal?: AbortSignal },
  ): Promise<DomainResult<BatchFromSubAgentOutput>> {
    if (!this.invokeSubAgent) {
      return domainErr("NOT_IMPLEMENTED", "invokeSubAgent not wired; FunctionList AI generate unavailable");
    }
    const count = Math.max(1, Math.min(20, input.count ?? 6));
    const meta = await this.safeGetProjectMeta(projectId as never);
    const ctx = meta ? `项目名：${meta.name}\n客户：${meta.clientName}\n` : "";
    const userPrompt = (input.prompt ?? "请基于项目背景生成功能列表条目").trim();
    const fullPrompt = `请基于以下项目背景生成 ${count} 条功能列表条目（提案方案中需要落地实施的功能点）。

${ctx}
用户补充：${userPrompt}

严格要求：
- 仅输出一段 **严格合法的 JSON 字符串**，不要任何其它文字、注释、Markdown 围栏
- 顶层 JSON 形状：[{"category":"<业务域>","module":"<子系统>","name":"<功能名>","cp":<1-21 的整数>,"inScope":<true|false>,"detail":"<一句话说明>"}]
- 长度恰好为 ${count} 项；不足时用空对象 {} 补齐，超过则截断
- 不要杜撰客户名 / 金额 / 日期；信息不足时字段填 "" 或 false`;

    let raw = "";
    try {
      raw = await collectStreamToString(
        this.invokeSubAgent("markdown-author", fullPrompt, { signal: opts?.signal }),
        opts?.signal,
      );
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") throw e;
      return domainErr("INTERNAL", `AI generate failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const items = parseFunctionListJson(raw, count);
    const created: FunctionListResult[] = [];
    for (const it of items) {
      const r = await this.createFunction(projectId, it);
      if (!r.ok) return r;
      created.push(r.value);
    }
    return domainOk({ created });
  }

  /** 阶段 7.5（H1）内部辅助 — 拉项目元信息 */
  private async safeGetProjectMeta(projectId: never): Promise<{ name: string; clientName: string } | null> {
    if (!this.getProjectMeta) return null;
    try {
      return await this.getProjectMeta(projectId);
    } catch {
      return null;
    }
  }

  // ---------- BudgetSettings（singleton per project）----------

  async getBudgetSettings(projectId: string): Promise<BudgetSettingsResult> {
    const items = await this.bm.listItems(projectId as never, BUDGET_SETTINGS_KIND);
    if (items.length === 0) {
      return { ...DEFAULT_BUDGET_SETTINGS };
    }
    // 单例：取最新的一条
    const newest = items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (!newest) return { ...DEFAULT_BUDGET_SETTINGS };
    return parseBudgetSettingsPayload(newest.payloadJson);
  }

  async updateBudgetSettings(
    projectId: string,
    input: Partial<BudgetSettingsPayload>,
  ): Promise<DomainResult<BudgetSettingsResult>> {
    const existing = await this.bm.listItems(projectId as never, BUDGET_SETTINGS_KIND);
    const next = makeBudgetSettingsPayload(input);
    const v = validateBudgetSettings(next);
    if (!v.ok) return domainErr("INVALID_INPUT", v.reason);

    let result: BusinessModuleItemSnapshot;
    if (existing.length === 0) {
      const r = await this.bm.createItem(projectId as never, BUDGET_SETTINGS_KIND, {
        title: "预算设置",
        content: "",
        payloadJson: JSON.stringify(next),
      });
      if (!r.ok) return r;
      result = r.value;
    } else {
      // 按 updatedAt 倒序：最新在前；保留最新一条；删除其余
      const sorted = existing.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const keep = sorted[0]!;
      const r = await this.bm.updateItem(keep.id, {
        payloadJson: JSON.stringify(next),
      });
      if (!r.ok) return r;
      result = r.value;
      // 清理多余行（如果有）
      for (const dup of sorted.slice(1)) {
        await this.bm.deleteItem(dup.id);
      }
    }
    return domainOk(parseBudgetSettingsPayload(result.payloadJson));
  }

  // ---------- BudgetSummary（派生，永不存库）----------

  async computeBudgetSummary(projectId: string): Promise<DomainResult<BudgetSummary>> {
    const settings = await this.getBudgetSettings(projectId);
    const fnSnaps = await this.bm.listItems(projectId as never, FUNCTION_LIST_KIND);
    const functions = fnSnaps.map((s) => parseFunctionListPayload(s.payloadJson));
    const summary = computeBudgetSummary(functions, settings);
    return domainOk(summary);
  }
}

// ---------- snapshot → DTO ----------

function snapToUseCase(snap: BusinessModuleItemSnapshot): UseCaseResult {
  const p = parseUseCasePayload(snap.payloadJson);
  return {
    id: snap.id,
    projectId: snap.projectId,
    title: snap.title,
    detail: snap.content,
    caseId: p.caseId,
    businessRules: p.businessRules,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

function snapToDeliverable(snap: BusinessModuleItemSnapshot): DeliverableResult {
  const p = parseDeliverablePayload(snap.payloadJson);
  return {
    id: snap.id,
    projectId: snap.projectId,
    title: snap.title,
    type: p.type,
    status: p.status,
    ...(p.owner !== undefined ? { owner: p.owner } : {}),
    ...(p.dueDate !== undefined ? { dueDate: p.dueDate } : {}),
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

function snapToReview(snap: BusinessModuleItemSnapshot): ReviewResult {
  const p = parseReviewPayload(snap.payloadJson);
  return {
    id: snap.id,
    projectId: snap.projectId,
    title: snap.title,
    dimension: p.dimension,
    score: p.score,
    weight: p.weight,
    comment: p.comment,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

// 计算字段需要 settings —— listFunctions / createFunction / updateFunction 都注入
function snapToFunction(
  snap: BusinessModuleItemSnapshot,
  settings: BudgetSettingsPayload,
): FunctionListResult {
  const p = parseFunctionListPayload(snap.payloadJson);
  const effortHours = computeFunctionEffortHours(p, settings);
  const amount = computeFunctionAmount(effortHours, settings);
  return {
    id: snap.id,
    projectId: snap.projectId,
    title: snap.title,
    category: p.category,
    module: p.module,
    name: p.name,
    detail: p.detail,
    remarks: p.remarks,
    cp: p.cp,
    inScope: p.inScope,
    effortHours,
    amount,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}

// 抑制未使用警告
void inScopeFunctions;

/**
 * 阶段 7.5（H1）内部辅助 — 解析 LLM 返回的 JSON；失败/长度不一致时回退到 N 个空 placeholder
 */
function parseFunctionListJson(raw: string, count: number): CreateFunctionListInput[] {
  const placeholder = (i: number): CreateFunctionListInput => ({
    category: "",
    module: "",
    name: `(待补充功能 ${i + 1})`,
    cp: 3,
    inScope: true,
    detail: "",
  });
  const text = raw.trim();
  if (!text) {
    return Array.from({ length: count }, (_, i) => placeholder(i));
  }
  // 尝试抽取第一段 JSON 数组（容错：模型偶尔带前缀说明文字）
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  const candidate = firstBracket >= 0 && lastBracket > firstBracket
    ? text.slice(firstBracket, lastBracket + 1)
    : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return Array.from({ length: count }, (_, i) => placeholder(i));
  }
  if (!Array.isArray(parsed)) {
    return Array.from({ length: count }, (_, i) => placeholder(i));
  }
  const out: CreateFunctionListInput[] = [];
  for (let i = 0; i < count; i++) {
    const v = parsed[i] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object") {
      out.push(placeholder(i));
      continue;
    }
    const cpRaw = typeof v.cp === "number" ? v.cp : Number(v.cp);
    const cp = Number.isFinite(cpRaw) && cpRaw >= 1 && cpRaw <= 21 ? Math.round(cpRaw) : 3;
    const inScope = typeof v.inScope === "boolean" ? v.inScope : true;
    out.push({
      category: typeof v.category === "string" ? v.category : "",
      module: typeof v.module === "string" ? v.module : "",
      name: typeof v.name === "string" && v.name.trim().length > 0 ? v.name : `(待补充功能 ${i + 1})`,
      cp,
      inScope,
      detail: typeof v.detail === "string" ? v.detail : "",
    });
  }
  return out;
}
