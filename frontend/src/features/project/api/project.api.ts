/**
 * Project API client —— 调后端 /api/projects
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";
import type {
  ChangeProjectStatusInput,
  CreateProjectInput,
  ProjectDTO,
  ProjectStatusValue,
  UpdateProjectInput,
} from "@shared/types/dto/project.ts";

export interface ProjectListQuery {
  status?: ProjectStatusValue;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProjectListResponse {
  items: ProjectDTO[];
  total: number;
  limit: number;
  offset: number;
}

export const projectApi = {
  list(query: ProjectListQuery = {}) {
    return http.get<ProjectListResponse>(Endpoints.projects, {
      query: {
        status: query.status,
        search: query.search,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      },
    });
  },
  get(id: string) {
    return http.get<ProjectDTO>(Endpoints.project(id));
  },
  create(input: CreateProjectInput) {
    return http.post<ProjectDTO>(Endpoints.projects, input);
  },
  rename(id: string, name: string) {
    return http.patch<ProjectDTO>(Endpoints.project(id), { name });
  },
  /** 阶段 7.5：更新项目元信息 —— 任意字段都可省略 */
  update(id: string, input: UpdateProjectInput) {
    return http.patch<ProjectDTO>(Endpoints.project(id), input);
  },
  /** 阶段 13（PR #1）：状态变更；input 透传给后端，由 service 校验必填字段 */
  changeStatus(id: string, input: ChangeProjectStatusInput) {
    return http.post<ProjectDTO>(`${Endpoints.project(id)}/status`, input);
  },
  remove(id: string) {
    return http.del<void>(Endpoints.project(id));
  },
};