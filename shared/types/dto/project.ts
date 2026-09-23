/**
 * 项目 DTO
 */

import type { IsoDateTime } from "../common.ts";

export type ProjectStatusValue = "新建" | "提案中" | "暂停" | "中标" | "未中标";

export interface ProjectContactDTO {
  id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
}

export interface TeamMemberDTO {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface ProjectDTO {
  id: string;
  code: string;             // 业务编号：年+5位流水
  name: string;
  clientName: string;
  clientWebsite?: string;
  clientIntro?: string;
  projectIntro?: string;
  startDate?: IsoDateTime;
  endDate?: IsoDateTime;
  status: ProjectStatusValue;
  pauseReason?: string;
  lostDate?: IsoDateTime;
  lostReason?: string;
  improvementNote?: string;
  wonDate?: IsoDateTime;
  bestPractice?: string;
  primaryContact?: ProjectContactDTO;
  contacts: readonly ProjectContactDTO[];
  teamMembers: readonly TeamMemberDTO[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateProjectInput {
  name: string;
  clientName: string;
  clientWebsite?: string;
  clientIntro?: string;
  projectIntro?: string;
  startDate?: IsoDateTime;
}

export interface UpdateProjectInput {
  name?: string;
  clientName?: string;
  clientWebsite?: string;
  clientIntro?: string;
  projectIntro?: string;
  startDate?: IsoDateTime;
}