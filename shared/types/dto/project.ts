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
  /** 阶段 13（PR #2）：项目工作区路径；未设置时为 undefined（fallback 到 ~/Desktop/<code>） */
  workspacePath?: string;
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

/**
 * 阶段 13（PR #1）：项目状态变更输入。
 *   - target = "中止" 时：pausedDate + stopReason 必填
 *   - target = "暂停" 时：reason 必填
 *   - target = "中标" 时：bestPractice 必填
 *   - target = "未中标" 时：lostReason + improvementNote 必填
 *   - 其他：无 Reason 字段
 */
export interface ChangeProjectStatusInput {
  target: ProjectStatusValue;
  reason?: string;
  /** 中止时必填 */
  pausedDate?: IsoDateTime;
  /** 中止时必填 */
  stopReason?: string;
  /** 中标时必填（默认今天，后端兜底） */
  wonDate?: IsoDateTime;
  /** 中标时必填 */
  bestPractice?: string;
  /** 未中标时必填（默认今天，后端兜底） */
  lostDate?: IsoDateTime;
  /** 未中标时必填 */
  lostReason?: string;
  /** 未中标时必填（复盘要点） */
  improvementNote?: string;
}
