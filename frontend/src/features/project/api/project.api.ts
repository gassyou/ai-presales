/**
 * Project API client —— 调后端 /api/projects
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";
import type {
  CreateProjectInput,
  ProjectDTO,
  ProjectStatusValue,
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
  changeStatus(id: string, target: ProjectStatusValue, reason?: string) {
    return http.post<ProjectDTO>(`${Endpoints.project(id)}/status`, { target, reason });
  },
  remove(id: string) {
    return http.del<void>(Endpoints.project(id));
  },
};