/**
 * contacts.api.ts —— 项目联系人 CRUD
 *
 * 阶段 7.4e。
 */

import { http } from "@frontend/shared/api/http-client.ts";
import type { ProjectContactDTO } from "@shared/types/dto/project.ts";

export interface CreateContactInput {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface UpdateContactInput {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export const contactsApi = {
  list(projectId: string) {
    return http.get<{ items: ProjectContactDTO[] }>(
      `/api/projects/${projectId}/contacts`,
    );
  },
  create(projectId: string, input: CreateContactInput) {
    return http.post<ProjectContactDTO>(
      `/api/projects/${projectId}/contacts`,
      input,
    );
  },
  update(projectId: string, contactId: string, input: UpdateContactInput) {
    return http.patch<ProjectContactDTO>(
      `/api/projects/${projectId}/contacts/${contactId}`,
      input,
    );
  },
  delete(projectId: string, contactId: string) {
    return http.del<void>(`/api/projects/${projectId}/contacts/${contactId}`);
  },
};