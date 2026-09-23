/**
 * hardwareItemsStore —— 硬件清单 Pinia store
 *
 * 阶段 7.4f。
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { hardwareItemsApi, type HardwareItemDTO, type HardwareItemInput } from "../api/hardware-items.api.ts";

export const useHardwareItemsStore = defineStore("hardwareItems", () => {
  const itemsByProject = ref<Map<string, HardwareItemDTO[]>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);

  function getItems(projectId: string): HardwareItemDTO[] {
    return itemsByProject.value.get(projectId) ?? [];
  }

  function totalSubtotal(projectId: string): number {
    return getItems(projectId).reduce((acc, it) => acc + it.item.subtotal, 0);
  }

  function getGroupedByCategory(projectId: string) {
    const items = getItems(projectId);
    const groups = new Map<string, HardwareItemDTO[]>();
    for (const it of items) {
      const cat = it.item.category.trim() || "(未分类)";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(it);
    }
    return Array.from(groups.entries()).map(([category, list]) => ({
      category,
      items: list,
      subtotal: list.reduce((acc, x) => acc + x.item.subtotal, 0),
    }));
  }

  async function load(projectId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const r = await hardwareItemsApi.list(projectId);
      itemsByProject.value.set(projectId, r.items);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function create(projectId: string, input: HardwareItemInput): Promise<HardwareItemDTO | null> {
    try {
      const dto = await hardwareItemsApi.create(projectId, input);
      const arr = itemsByProject.value.get(projectId) ?? [];
      itemsByProject.value.set(projectId, [...arr, dto]);
      return dto;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async function update(
    projectId: string,
    id: string,
    patch: Partial<HardwareItemInput>,
  ): Promise<HardwareItemDTO | null> {
    try {
      const dto = await hardwareItemsApi.update(id, patch);
      const arr = itemsByProject.value.get(projectId) ?? [];
      itemsByProject.value.set(
        projectId,
        arr.map((x) => (x.id === id ? dto : x)),
      );
      return dto;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async function remove(projectId: string, id: string): Promise<boolean> {
    try {
      await hardwareItemsApi.delete(id);
      const arr = itemsByProject.value.get(projectId) ?? [];
      itemsByProject.value.set(projectId, arr.filter((x) => x.id !== id));
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  return {
    itemsByProject,
    loading,
    error,
    getItems,
    totalSubtotal,
    getGroupedByCategory,
    load,
    create,
    update,
    remove,
  };
});