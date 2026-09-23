/**
 * Mail domain —— 邮件快照 + 状态机
 *
 * 阶段 7.4e。
 *
 * MVP 状态机：
 *   draft → sent
 *
 * 字段：
 *   - to/cc：邮件地址快照 [{name,email}]，存 to_json/cc_json；
 *     联系人画像不存此处（独立的 project_contacts 表）
 *   - attachments 独立表（emails / email_attachments 一对多）
 */

import type { ProjectId } from "@shared/types/ids.ts";

export type EmailStatus = "draft" | "sent" | "failed";

export interface Address {
  readonly name: string;
  readonly email: string;
}

export interface EmailSnapshot {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly subject: string;
  readonly body: string;
  readonly to: readonly Address[];
  readonly cc: readonly Address[];
  readonly status: EmailStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly sentAt: Date | null;
  /** 阶段 7.4h：SMTP 失败时记时间 */
  readonly failedAt?: Date | null;
  /** 阶段 7.4h：SMTP 失败时记错误信息 */
  readonly errorMessage?: string | null;
}

export interface EmailAttachmentSnapshot {
  readonly id: string;
  readonly emailId: string;
  readonly filename: string;
  readonly mime: string;
  readonly size: number;
  readonly pathOnDisk: string;
  readonly createdAt: Date;
}

/**
 * 状态机校验：MVP 仅 draft → sent。
 * 'failed' 留接口（本阶段不写入）。
 */
export function canSend(status: EmailStatus): boolean {
  return status === "draft";
}

export function canEdit(status: EmailStatus): boolean {
  return status === "draft";
}

export function parseAddresses(json: string): Address[] {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x === "object" && typeof x.email === "string")
      .map((x: { name?: string; email: string }) => ({
        name: typeof x.name === "string" ? x.name : "",
        email: x.email,
      }));
  } catch {
    return [];
  }
}

export function serializeAddresses(addrs: readonly Address[]): string {
  return JSON.stringify(addrs.map((a) => ({ name: a.name, email: a.email })));
}