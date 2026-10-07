/**
 * ProjectStore —— Pinia store，集中项目列表 / 当前项目状态
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  projectApi,
  type ProjectListQuery,
} from "@frontend/features/project/api/project.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import type {
  ChangeProjectStatusInput,
  CreateProjectInput,
  ProjectDTO,
} from "@shared/types/dto/project.ts";

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

  async function create(input: CreateProjectInput): Promise<ProjectDTO> {
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

  /** 状态变更（中标/未中标/暂停/提案中等） */
  async function changeStatus(
    id: string,
    input: ChangeProjectStatusInput,
  ): Promise<ProjectDTO> {
    const dto = await projectApi.changeStatus(id, input);
    replace(dto);
    return dto;
  }

  /** 阶段 13（PR #2）：设置 / 清空项目工作区路径 */
  async function setWorkspace(
    id: string,
    workspacePath: string | null,
  ): Promise<ProjectDTO> {
    const dto = await projectApi.setWorkspace(id, workspacePath);
    replace(dto);
    return dto;
  }

  /** 阶段 13（PR #2）：查询当前生效的工作区路径 */
  async function resolveWorkspace(id: string): Promise<string> {
    const { resolvedPath } = await projectApi.resolveWorkspace(id);
    return resolvedPath;
  }

  /**
   * 阶段 13（PR #2）：一键创建工作区文件夹。
   * 后端会 mkdir(recursive: true)；已存在则只落库不创建。
   * workspacePath 缺省 = 用项目自带或默认 (~/Desktop/<code>)。
   * 返回最新 ProjectDTO + workspace 状态 { path, created, existed }。
   */
  async function ensureWorkspace(
    id: string,
    workspacePath?: string | null,
  ): Promise<{
    project: ProjectDTO;
    workspace: { path: string; created: boolean; existed: boolean };
  }> {
    const r = await projectApi.ensureWorkspace(id, workspacePath);
    replace(r.project);
    return r;
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

  return {
    items,
    total,
    loading,
    error,
    lastQuery,
    load,
    create,
    rename,
    changeStatus,
    setWorkspace,
    resolveWorkspace,
    ensureWorkspace,
    remove,
  };
});
