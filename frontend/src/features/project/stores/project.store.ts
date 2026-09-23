/**
 * ProjectStore —— Pinia store，集中项目列表 / 当前项目状态
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { projectApi, type ProjectListQuery } from "@frontend/features/project/api/project.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";

export const useProjectStore = defineStore("project", () => {
  const items = ref<ProjectDTO[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastQuery = ref<ProjectListQuery>({ limit: 50, offset: 0 });

  async function load(query: ProjectListQuery = {}): Promise<void> {
    const merged: ProjectListQuery = { ...lastQuery.value, ...query };
    lastQuery.value = merged;
    loading.value = true;
    error.value = null;
    try {
      const res = await projectApi.list(merged);
      items.value = res.items;
      total.value = res.total;
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.envelope.message;
      } else {
        error.value = e instanceof Error ? e.message : String(e);
      }
      items.value = [];
      total.value = 0;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: { name: string; clientName: string }): Promise<ProjectDTO> {
    const dto = await projectApi.create(input);
    // prepend so user sees it immediately
    items.value = [dto, ...items.value];
    total.value += 1;
    return dto;
  }

  async function rename(id: string, name: string): Promise<ProjectDTO> {
    const dto = await projectApi.rename(id, name);
    replace(dto);
    return dto;
  }

  async function changeStatus(id: string, target: ProjectDTO["status"]): Promise<ProjectDTO> {
    const dto = await projectApi.changeStatus(id, target);
    replace(dto);
    return dto;
  }

  async function remove(id: string): Promise<void> {
    await projectApi.remove(id);
    items.value = items.value.filter((p) => p.id !== id);
    total.value = Math.max(0, total.value - 1);
  }

  function replace(dto: ProjectDTO): void {
    const i = items.value.findIndex((p) => p.id === dto.id);
    if (i >= 0) items.value.splice(i, 1, dto);
    else items.value.unshift(dto);
  }

  return { items, total, loading, error, lastQuery, load, create, rename, changeStatus, remove };
});