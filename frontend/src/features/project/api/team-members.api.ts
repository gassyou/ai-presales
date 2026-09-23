/**
 * team-members.api.ts —— 项目团队成员 CRUD
 */

import { http } from "@frontend/shared/api/http-client.ts";
import type { TeamMemberDTO } from "@shared/types/dto/project.ts";

export interface CreateMemberInput {
  name: string;
  email?: string;
  phone?: string;
}

export interface UpdateMemberInput {
  name?: string;
  email?: string;
  phone?: string;
}

export const teamMembersApi = {
  list(projectId: string) {
    return http.get<{ items: TeamMemberDTO[] }>(
      `/api/projects/${projectId}/team-members`,
    );
  },
  create(projectId: string, input: CreateMemberInput) {
    return http.post<TeamMemberDTO>(
      `/api/projects/${projectId}/team-members`,
      input,
    );
  },
  update(projectId: string, memberId: string, input: UpdateMemberInput) {
    return http.patch<TeamMemberDTO>(
      `/api/projects/${projectId}/team-members/${memberId}`,
      input,
    );
  },
  delete(projectId: string, memberId: string) {
    return http.del<void>(`/api/projects/${projectId}/team-members/${memberId}`);
  },
};