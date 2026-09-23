/**
 * IProjectTeamMembersRepository —— 项目团队成员仓储接口
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import type { TeamMemberSnapshot } from "./project-team-members.ts";

export interface CreateTeamMemberArgs {
  projectId: ProjectId;
  name: string;
  email?: string;
  phone?: string;
  /** 测试用：固定 ID */
  id?: string;
}

export interface UpdateTeamMemberArgs {
  name?: string;
  email?: string;
  phone?: string;
}

export interface IProjectTeamMembersRepository {
  listByProject(projectId: ProjectId): Promise<TeamMemberSnapshot[]>;
  findById(id: string): Promise<TeamMemberSnapshot | null>;
  create(args: CreateTeamMemberArgs & { createdAt: Date }): Promise<DomainResult<TeamMemberSnapshot>>;
  update(id: string, args: UpdateTeamMemberArgs, updatedAt: Date): Promise<DomainResult<TeamMemberSnapshot>>;
  delete(id: string): Promise<DomainResult<void>>;
}