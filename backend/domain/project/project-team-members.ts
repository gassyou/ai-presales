/**
 * ProjectTeamMember —— 项目团队成员快照
 *
 * 阶段 7.4e。独立表存储（FK→projects, ON DELETE CASCADE）。
 *
 * 字段：
 *   - name：必填
 *   - email / phone：可选
 */

import type { ProjectId } from "@shared/types/ids.ts";

export interface TeamMemberSnapshot {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTeamMemberInput(input: { name?: string; email?: string }): string | null {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return "name is required";
  }
  if (input.name.length > 100) return "name too long (max 100)";
  if (input.email !== undefined && input.email.length > 0 && !EMAIL_RE.test(input.email)) {
    return `invalid email: ${input.email}`;
  }
  return null;
}