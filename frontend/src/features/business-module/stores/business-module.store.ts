/**
 * BusinessModule Store —— 业务模块条目 Pinia store
 *
 * 阶段 7.0。缓存按 (projectId, kind) 分组；提供 list / create / update / delete / adopt / unadopt。
 *
 * 适用所有 kind（markdown_* 与结构化共用）。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  businessModuleApi,
  type AdoptionStatus,
  type ListItemsResult,
} from "../api/business-module.api.ts";
import type {
  BusinessModuleItemDTO,
  CreateBusinessModuleItemDTO,
  UpdateBusinessModuleItemDTO,
} from "@shared/types/dto/business-module.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

export interface ProjectKindKey {
  projectId: string;
  kind: BusinessModuleKind;
}

function keyOf({ projectId, kind }: ProjectKindKey): string {
  return `${projectId}::${kind}`;
}

export const useBusinessModuleStore = defineStore("business-module", () => {
  /** 按 projectId+kind 缓存的列表快照 */
  const itemLists = ref<Map<string, BusinessModuleItemDTO[]>>(new Map());
  /** 当前 loading 的 key */
  const loading = ref<string | null>(null);
  const error = ref<string | null>(null);

  async function loadList(
    projectId: string,
    kind: BusinessModuleKind,
    opts?: { status?: AdoptionStatus },
  ): Promise<void> {
    const k = keyOf({ projectId, kind });
    loading.value = k;
    error.value = null;
    try {
      const r: ListItemsResult = await businessModuleApi.list(projectId, kind, opts);
      itemLists.value.set(k, r.items);
      itemLists.value = new Map(itemLists.value);
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    } finally {
      loading.value = null;
    }
  }

  async function createItem(
    projectId: string,
    kind: BusinessModuleKind,
    body: CreateBusinessModuleItemDTO,
  ): Promise<BusinessModuleItemDTO | null> {
    error.value = null;
    try {
      const item = await businessModuleApi.create(projectId, kind, body);
      await loadList(projectId, kind);
      return item;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function updateItem(
    itemId: string,
    projectId: string,
    kind: BusinessModuleKind,
    body: UpdateBusinessModuleItemDTO,
  ): Promise<BusinessModuleItemDTO | null> {
    error.value = null;
    try {
      const item = await businessModuleApi.update(itemId, body);
      await loadList(projectId, kind);
      return item;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function deleteItem(
    itemId: string,
    projectId: string,
    kind: BusinessModuleKind,
  ): Promise<boolean> {
    error.value = null;
    try {
      await businessModuleApi.delete(itemId);
      await loadList(projectId, kind);
      return true;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function adopt(
    itemId: string,
    projectId: string,
    kind: BusinessModuleKind,
  ): Promise<BusinessModuleItemDTO | null> {
    error.value = null;
    try {
      const item = await businessModuleApi.adopt(itemId);
      await loadList(projectId, kind);
      return item;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function unadopt(
    itemId: string,
    projectId: string,
    kind: BusinessModuleKind,
  ): Promise<BusinessModuleItemDTO | null> {
    error.value = null;
    try {
      const item = await businessModuleApi.unadopt(itemId);
      await loadList(projectId, kind);
      return item;
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  function getList(projectId: string, kind: BusinessModuleKind): BusinessModuleItemDTO[] {
    return itemLists.value.get(keyOf({ projectId, kind })) ?? [];
  }

  function isLoading(projectId: string, kind: BusinessModuleKind): boolean {
    return loading.value === keyOf({ projectId, kind });
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    itemLists,
    loading,
    error,
    loadList,
    createItem,
    updateItem,
    deleteItem,
    adopt,
    unadopt,
    getList,
    isLoading,
    clearError,
  };
});
