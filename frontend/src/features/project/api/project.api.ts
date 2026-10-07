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
  /** 阶段 13（PR #2）：状态变更；input 透传给后端，由 service 校验必填字段 */
  changeStatus(id: string, input: ChangeProjectStatusInput) {
    return http.post<ProjectDTO>(`${Endpoints.project(id)}/status`, input);
  },
  /** 阶段 13（PR #2）：设置 / 清空项目工作区路径；workspacePath=null 表示清空回退到默认 */
  setWorkspace(id: string, workspacePath: string | null) {
    return http.post<ProjectDTO>(Endpoints.projectWorkspace(id), { workspacePath });
  },
  /** 阶段 13（PR #2）：查询当前生效的工作区路径 */
  resolveWorkspace(id: string) {
    return http.get<{ resolvedPath: string }>(Endpoints.projectWorkspace(id));
  },
  /** 阶段 13（PR #2）：一键创建工作区文件夹（mac/win/linux 跨平台 mkdir recursive）
   *  - workspacePath 缺省 = 用项目自带或默认 (~/Desktop/<code>)
   *  - 已存在 → 只落库不创建
   *  - 不存在 → mkdir(recursive) 后落库
   * 返回 { project: ProjectDTO, workspace: { path, created, existed } }
   */
  ensureWorkspace(id: string, workspacePath?: string | null) {
    const body = workspacePath !== undefined
      ? { workspacePath }
      : {};
    return http.post<{
      project: ProjectDTO;
      workspace: { path: string; created: boolean; existed: boolean };
    }>(`${Endpoints.projectWorkspace(id)}/ensure`, body);
  },
  remove(id: string) {
    return http.del<void>(Endpoints.project(id));
  },
};