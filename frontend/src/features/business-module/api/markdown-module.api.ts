/**
 * MarkdownModule API —— markdown_* 模块统一端点
 *
 * 阶段 7.3。
 */

import { http } from "@frontend/shared/api/http-client.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";

export interface MarkdownModuleResult {
  id: string;
  projectId: string;
  kind: BusinessModuleKind;
  title: string;
  content: string;
  status: "pending" | "adopted" | "unadopted";
  createdAt: string;
  updatedAt: string;
}

export const markdownModuleApi = {
  get(projectId: string, kind: BusinessModuleKind) {
    return http.get<{ item: MarkdownModuleResult | null }>(
      `/api/projects/${projectId}/modules/${kind}/markdown`,
    );
  },
  getOrInit(projectId: string, kind: BusinessModuleKind) {
    return http.post<MarkdownModuleResult>(
      `/api/projects/${projectId}/modules/${kind}/markdown`,
    );
  },
  save(projectId: string, kind: BusinessModuleKind, content: string) {
    return http.put<MarkdownModuleResult>(
      `/api/projects/${projectId}/modules/${kind}/markdown`,
      { content },
    );
  },
  generate(projectId: string, kind: BusinessModuleKind) {
    return http.post<MarkdownModuleResult>(
      `/api/projects/${projectId}/modules/${kind}/markdown/generate`,
    );
  },
  adopt(projectId: string, kind: BusinessModuleKind) {
    return http.post<MarkdownModuleResult>(
      `/api/projects/${projectId}/modules/${kind}/markdown/adopt`,
    );
  },
  unadopt(projectId: string, kind: BusinessModuleKind) {
    return http.post<MarkdownModuleResult>(
      `/api/projects/${projectId}/modules/${kind}/markdown/unadopt`,
    );
  },
};
