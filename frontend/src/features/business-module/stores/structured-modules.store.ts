/**
 * StructuredModules Store —— 用例 / 交付物 / Review 三个结构化模块的 Pinia store
 *
 * 阶段 7.4a。每种模块各自缓存列表；Review 额外缓存 summary。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  structuredModulesApi,
  type DeliverableDTO,
  type DeliverableInput,
  type DeliverableStatus,
  type ReviewDTO,
  type ReviewInput,
  type ReviewSummary,
  type UseCaseDTO,
  type UseCaseInput,
} from "../api/structured-modules.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error
    ? e.message
    : String(e);
}

export const useStructuredModulesStore = defineStore("structured-modules", () => {
  // ---------- UseCase ----------
  const useCasesByProject = ref<Map<string, UseCaseDTO[]>>(new Map());
  const useCaseError = ref<string | null>(null);

  async function loadUseCases(projectId: string): Promise<void> {
    try {
      const r = await structuredModulesApi.listUseCases(projectId);
      useCasesByProject.value.set(projectId, r.items);
      useCasesByProject.value = new Map(useCasesByProject.value);
      useCaseError.value = null;
    } catch (e) {
      useCaseError.value = errMsg(e);
    }
  }

  async function createUseCase(
    projectId: string,
    input: UseCaseInput,
  ): Promise<UseCaseDTO | null> {
    try {
      const it = await structuredModulesApi.createUseCase(projectId, input);
      await loadUseCases(projectId);
      return it;
    } catch (e) {
      useCaseError.value = errMsg(e);
      return null;
    }
  }

  async function updateUseCase(
    projectId: string,
    id: string,
    input: Partial<UseCaseInput>,
  ): Promise<UseCaseDTO | null> {
    try {
      const it = await structuredModulesApi.updateUseCase(id, input);
      await loadUseCases(projectId);
      return it;
    } catch (e) {
      useCaseError.value = errMsg(e);
      return null;
    }
  }

  async function deleteUseCase(projectId: string, id: string): Promise<boolean> {
    try {
      await structuredModulesApi.deleteUseCase(id);
      await loadUseCases(projectId);
      return true;
    } catch (e) {
      useCaseError.value = errMsg(e);
      return false;
    }
  }

  // ---------- Deliverable ----------
  const deliverablesByProject = ref<Map<string, DeliverableDTO[]>>(new Map());
  const deliverableError = ref<string | null>(null);

  async function loadDeliverables(projectId: string): Promise<void> {
    try {
      const r = await structuredModulesApi.listDeliverables(projectId);
      deliverablesByProject.value.set(projectId, r.items);
      deliverablesByProject.value = new Map(deliverablesByProject.value);
      deliverableError.value = null;
    } catch (e) {
      deliverableError.value = errMsg(e);
    }
  }

  async function createDeliverable(
    projectId: string,
    input: DeliverableInput,
  ): Promise<DeliverableDTO | null> {
    try {
      const it = await structuredModulesApi.createDeliverable(projectId, input);
      await loadDeliverables(projectId);
      return it;
    } catch (e) {
      deliverableError.value = errMsg(e);
      return null;
    }
  }

  async function updateDeliverable(
    projectId: string,
    id: string,
    input: Partial<DeliverableInput>,
  ): Promise<DeliverableDTO | null> {
    try {
      const it = await structuredModulesApi.updateDeliverable(id, input);
      await loadDeliverables(projectId);
      return it;
    } catch (e) {
      deliverableError.value = errMsg(e);
      return null;
    }
  }

  async function setDeliverableStatus(
    projectId: string,
    id: string,
    status: DeliverableStatus,
  ): Promise<DeliverableDTO | null> {
    return await updateDeliverable(projectId, id, { status });
  }

  async function deleteDeliverable(projectId: string, id: string): Promise<boolean> {
    try {
      await structuredModulesApi.deleteDeliverable(id);
      await loadDeliverables(projectId);
      return true;
    } catch (e) {
      deliverableError.value = errMsg(e);
      return false;
    }
  }

  // ---------- Review ----------
  const reviewsByProject = ref<Map<string, ReviewDTO[]>>(new Map());
  const reviewSummaryByProject = ref<Map<string, ReviewSummary>>(new Map());
  const reviewError = ref<string | null>(null);

  async function loadReviews(projectId: string): Promise<void> {
    try {
      const r = await structuredModulesApi.listReviews(projectId);
      reviewsByProject.value.set(projectId, r.items);
      reviewSummaryByProject.value.set(projectId, r.summary);
      reviewsByProject.value = new Map(reviewsByProject.value);
      reviewSummaryByProject.value = new Map(reviewSummaryByProject.value);
      reviewError.value = null;
    } catch (e) {
      reviewError.value = errMsg(e);
    }
  }

  async function createReview(
    projectId: string,
    input: ReviewInput,
  ): Promise<ReviewDTO | null> {
    try {
      const it = await structuredModulesApi.createReview(projectId, input);
      await loadReviews(projectId);
      return it;
    } catch (e) {
      reviewError.value = errMsg(e);
      return null;
    }
  }

  async function updateReview(
    projectId: string,
    id: string,
    input: Partial<ReviewInput>,
  ): Promise<ReviewDTO | null> {
    try {
      const it = await structuredModulesApi.updateReview(id, input);
      await loadReviews(projectId);
      return it;
    } catch (e) {
      reviewError.value = errMsg(e);
      return null;
    }
  }

  async function deleteReview(projectId: string, id: string): Promise<boolean> {
    try {
      await structuredModulesApi.deleteReview(id);
      await loadReviews(projectId);
      return true;
    } catch (e) {
      reviewError.value = errMsg(e);
      return false;
    }
  }

  return {
    // state
    useCasesByProject,
    useCaseError,
    deliverablesByProject,
    deliverableError,
    reviewsByProject,
    reviewSummaryByProject,
    reviewError,
    // actions
    loadUseCases,
    createUseCase,
    updateUseCase,
    deleteUseCase,
    loadDeliverables,
    createDeliverable,
    updateDeliverable,
    setDeliverableStatus,
    deleteDeliverable,
    loadReviews,
    createReview,
    updateReview,
    deleteReview,
  };
});