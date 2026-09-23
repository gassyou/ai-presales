/**
 * StructuredModules API —— 用例 / 交付物 / Review 三个结构化模块
 *
 * 阶段 7.4a。后端走 StructuredModulesUseCase + handleStructuredModules。
 */

import { http } from "@frontend/shared/api/http-client.ts";

// ---------- UseCase ----------
export interface UseCaseDTO {
  id: string;
  projectId: string;
  title: string;
  detail: string;
  caseId: string;
  businessRules: string;
  createdAt: string;
  updatedAt: string;
}

export interface UseCaseInput {
  title: string;
  detail?: string;
  caseId?: string;
  businessRules?: string;
}

// ---------- Deliverable ----------
export type DeliverableStatus = "not_started" | "in_progress" | "completed" | "cancelled";

export interface DeliverableDTO {
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

export interface DeliverableInput {
  title: string;
  type?: string;
  owner?: string;
  dueDate?: string;
  status?: DeliverableStatus;
}

// ---------- Review ----------
export interface ReviewDTO {
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

export interface ReviewInput {
  title: string;
  dimension: string;
  score?: number;
  weight?: number;
  comment?: string;
}

export interface ReviewSummary {
  totalScore: number;
  itemCount: number;
}

// ---------- FunctionList ----------
export const CP_VALUES = [1, 2, 3, 5, 8, 13, 21] as const;

export interface FunctionListDTO {
  id: string;
  projectId: string;
  title: string;
  category: string;
  module: string;
  name: string;
  detail: string;
  remarks: string;
  cp: number;
  inScope: boolean;
  effortHours: number;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FunctionListInput {
  category?: string;
  module?: string;
  name?: string;
  detail?: string;
  remarks?: string;
  cp?: number;
  inScope?: boolean;
}

// ---------- BudgetSettings ----------
export interface BudgetSettingsDTO {
  hoursPerCP: number;
  hoursPerDay: number;
  unitPrice: number;
  reqAnalysisRatio: number;
  basicDesignRatio: number;
  testRatio: number;
  managementRatio: number;
  bufferRatio: number;
  deployDays: number;
  trainingDays: number;
}

export type BudgetSettingsInput = Partial<BudgetSettingsDTO>;

// ---------- BudgetSummary ----------
export interface TopSummaryDTO {
  totalCP: number;
  totalEffortHours: number;
  functionTotalAmount: number;
  deployTrainingAmount: number;
  totalAmountExclTax: number;
  totalPeriodDays: number;
}

export interface ModuleBudgetRowDTO {
  category: string;
  module: string;
  manDays: number;
  amount: number;
  periodDays: number;
  periodMonths: number;
}

export interface ModuleBudgetTableDTO {
  rows: ModuleBudgetRowDTO[];
  deploy: ModuleBudgetRowDTO;
  training: ModuleBudgetRowDTO;
  buffer: ModuleBudgetRowDTO;
  total: ModuleBudgetRowDTO;
}

export interface PhaseBudgetRowDTO {
  phase: string;
  manDays: number;
  amount: number;
  periodDays: number;
  periodMonths: number;
}

export interface BudgetSummaryDTO {
  top: TopSummaryDTO;
  byModule: ModuleBudgetTableDTO;
  byPhase: PhaseBudgetRowDTO[];
}

export const structuredModulesApi = {
  // UseCase
  listUseCases(projectId: string) {
    return http.get<{ items: UseCaseDTO[] }>(`/api/projects/${projectId}/use-cases`);
  },
  createUseCase(projectId: string, body: UseCaseInput) {
    return http.post<UseCaseDTO>(`/api/projects/${projectId}/use-cases`, body);
  },
  updateUseCase(id: string, body: Partial<UseCaseInput>) {
    return http.patch<UseCaseDTO>(`/api/use-cases/${id}`, body);
  },
  deleteUseCase(id: string) {
    return http.del<void>(`/api/use-cases/${id}`);
  },

  // Deliverable
  listDeliverables(projectId: string) {
    return http.get<{ items: DeliverableDTO[] }>(`/api/projects/${projectId}/deliverables`);
  },
  createDeliverable(projectId: string, body: DeliverableInput) {
    return http.post<DeliverableDTO>(`/api/projects/${projectId}/deliverables`, body);
  },
  updateDeliverable(id: string, body: Partial<DeliverableInput>) {
    return http.patch<DeliverableDTO>(`/api/deliverables/${id}`, body);
  },
  deleteDeliverable(id: string) {
    return http.del<void>(`/api/deliverables/${id}`);
  },

  // Review
  listReviews(projectId: string) {
    return http.get<{ items: ReviewDTO[]; summary: ReviewSummary }>(
      `/api/projects/${projectId}/reviews`,
    );
  },
  reviewSummary(projectId: string) {
    return http.get<ReviewSummary>(`/api/projects/${projectId}/reviews/summary`);
  },
  createReview(projectId: string, body: ReviewInput) {
    return http.post<ReviewDTO>(`/api/projects/${projectId}/reviews`, body);
  },
  updateReview(id: string, body: Partial<ReviewInput>) {
    return http.patch<ReviewDTO>(`/api/reviews/${id}`, body);
  },
  deleteReview(id: string) {
    return http.del<void>(`/api/reviews/${id}`);
  },

  // FunctionList（走通用 CRUD：/modules/function_list/items）
  listFunctions(projectId: string) {
    return http.get<{ items: FunctionListDTO[]; kind: string; projectId: string }>(
      `/api/projects/${projectId}/modules/function_list/items`,
    );
  },
  createFunction(projectId: string, body: FunctionListInput) {
    // 注意：title / content / payloadJson 都由后端 usecase 拼接，前端发原始字段即可
    return http.post<FunctionListDTO>(
      `/api/projects/${projectId}/modules/function_list/items`,
      body,
    );
  },
  // 阶段 7.5（H1）：功能列表 AI 一键生成
  batchFromSubAgent(
    projectId: string,
    body: { prompt?: string; count?: number } = {},
  ) {
    return http.post<{ items: FunctionListDTO[] }>(
      `/api/projects/${projectId}/modules/function_list/items?action=batchFromSubAgent`,
      body,
    );
  },
  updateFunction(id: string, body: Partial<FunctionListInput>) {
    return http.patch<FunctionListDTO>(`/api/modules/items/${id}`, body);
  },
  deleteFunction(id: string) {
    return http.del<void>(`/api/modules/items/${id}`);
  },

  // BudgetSettings（singleton）
  getBudgetSettings(projectId: string) {
    return http.get<BudgetSettingsDTO>(`/api/projects/${projectId}/budget-settings`);
  },
  updateBudgetSettings(projectId: string, body: BudgetSettingsInput) {
    return http.put<BudgetSettingsDTO>(`/api/projects/${projectId}/budget-settings`, body);
  },

  // BudgetSummary（派生，GET only）
  getBudgetSummary(projectId: string) {
    return http.get<BudgetSummaryDTO>(`/api/projects/${projectId}/budget-summary`);
  },
};