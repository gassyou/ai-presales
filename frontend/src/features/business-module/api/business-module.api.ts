/**
 * BusinessModule API —— 业务模块通用 CRUD
 *
 * 阶段 7.0。前端只关心 kind + projectId + item。
 */

import { http } from "@frontend/shared/api/http-client.ts";
import type {
  BusinessModuleItemDTO,
  CreateBusinessModuleItemDTO,
  UpdateBusinessModuleItemDTO,
} from "@shared/types/dto/business-module.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";

export type AdoptionStatus = "pending" | "adopted" | "unadopted";

export interface ListItemsResult {
  items: BusinessModuleItemDTO[];
  kind: BusinessModuleKind;
  projectId: string;
}

export const businessModuleApi = {
  list(projectId: string, kind: BusinessModuleKind, opts?: { status?: AdoptionStatus }) {
    return http.get<ListItemsResult>(
      `/api/projects/${projectId}/modules/${kind}/items`,
      { query: opts?.status ? { status: opts.status } : undefined },
    );
  },
  create(
    projectId: string,
    kind: BusinessModuleKind,
    body: CreateBusinessModuleItemDTO,
  ) {
    return http.post<BusinessModuleItemDTO>(
      `/api/projects/${projectId}/modules/${kind}/items`,
      body,
    );
  },
  get(itemId: string) {
    return http.get<BusinessModuleItemDTO>(`/api/modules/items/${itemId}`);
  },
  update(itemId: string, body: UpdateBusinessModuleItemDTO) {
    return http.patch<BusinessModuleItemDTO>(`/api/modules/items/${itemId}`, body);
  },
  delete(itemId: string) {
    return http.del<void>(`/api/modules/items/${itemId}`);
  },
  adopt(itemId: string) {
    return http.post<BusinessModuleItemDTO>(`/api/modules/items/${itemId}/adopt`);
  },
  unadopt(itemId: string) {
    return http.post<BusinessModuleItemDTO>(`/api/modules/items/${itemId}/unadopt`);
  },
  generate(itemId: string) {
    return http.post<BusinessModuleItemDTO>(`/api/modules/items/${itemId}/generate`);
  },
};
