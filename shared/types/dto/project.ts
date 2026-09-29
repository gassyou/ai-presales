/**
 * 项目 DTO
 */

import type { IsoDateTime } from "../common.ts";

export type ProjectStatusValue =
  | "新建"
  | "提案中"
  | "暂停"
  | "中标"
  | "未中标"
  | "中止";

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
  code: string; // 业务编号：年+5位流水
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
  endDate?: IsoDateTime;
}

export interface UpdateProjectInput {
  name?: string;
  clientName?: string;
  /**
   * 阶段 7.5：编辑语义
   *   - 字段缺失（undefined）= 不修改
   *   - null = 清空字段
   *   - string = 写入（trim 后写入；空字符串后端会视为清空）
   */
  clientWebsite?: string | null;
  clientIntro?: string | null;
  projectIntro?: string | null;
  startDate?: IsoDateTime | null;
  endDate?: IsoDateTime | null;
}
