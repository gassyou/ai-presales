/**
 * IEmailRepository —— 邮件 + 附件 仓储接口
 *
 * 阶段 7.4e。emails + email_attachments 合一接口。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import type {
  Address,
  EmailAttachmentSnapshot,
  EmailSnapshot,
  EmailStatus,
} from "./email.ts";

export interface CreateEmailArgs {
  projectId: ProjectId;
  subject?: string;
  body?: string;
  to?: readonly Address[];
  cc?: readonly Address[];
  /** 测试用：固定 ID */
  id?: string;
  createdAt: Date;
}

export interface UpdateEmailArgs {
  subject?: string;
  body?: string;
  to?: readonly Address[];
  cc?: readonly Address[];
}

export interface AddAttachmentArgs {
  emailId: string;
  filename: string;
  mime: string;
  size: number;
  pathOnDisk: string;
  createdAt: Date;
  /** 测试用：固定 ID */
  id?: string;
}

export interface IEmailRepository {
  // emails
  listByProject(projectId: ProjectId): Promise<EmailSnapshot[]>;
  findById(id: string): Promise<EmailSnapshot | null>;
  create(args: CreateEmailArgs): Promise<DomainResult<EmailSnapshot>>;
  updateDraft(
    id: string,
    args: UpdateEmailArgs,
    updatedAt: Date,
  ): Promise<DomainResult<EmailSnapshot>>;
  markSent(id: string, sentAt: Date): Promise<DomainResult<EmailSnapshot>>;
  /** 阶段 7.4h：SMTP 失败时记 failed_at + error_message */
  markFailed(id: string, failedAt: Date, errorMessage: string): Promise<DomainResult<EmailSnapshot>>;

  // attachments
  listAttachments(emailId: string): Promise<EmailAttachmentSnapshot[]>;
  findAttachment(id: string): Promise<EmailAttachmentSnapshot | null>;
  addAttachment(args: AddAttachmentArgs): Promise<DomainResult<EmailAttachmentSnapshot>>;
  removeAttachment(id: string): Promise<DomainResult<void>>;
}