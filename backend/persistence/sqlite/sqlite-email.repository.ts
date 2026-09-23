/**
 * SqliteEmailRepository —— emails + email_attachments 表的 SQLite 实现
 *
 * 阶段 7.4e。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import {
  type AddAttachmentArgs,
  type CreateEmailArgs,
  type IEmailRepository,
  type UpdateEmailArgs,
} from "@backend/domain/mail/email.repository.ts";
import {
  type EmailAttachmentSnapshot,
  type EmailSnapshot,
  type EmailStatus,
  parseAddresses,
  serializeAddresses,
} from "@backend/domain/mail/email.ts";
import type { Database } from "../database/database.ts";

interface EmailRow {
  id: string;
  project_id: string;
  subject: string;
  body: string;
  to_json: string;
  cc_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  failed_at: string | null;
  error_message: string | null;
}

interface AttachmentRow {
  id: string;
  email_id: string;
  filename: string;
  mime: string;
  size: number;
  path_on_disk: string;
  created_at: string;
}

function rowToSnapshot(row: EmailRow): EmailSnapshot {
  return {
    id: row.id,
    projectId: toProjectId(row.project_id),
    subject: row.subject,
    body: row.body,
    to: parseAddresses(row.to_json),
    cc: parseAddresses(row.cc_json),
    status: row.status as EmailStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    failedAt: row.failed_at ? new Date(row.failed_at) : null,
    errorMessage: row.error_message,
  };
}

function rowToAttachment(row: AttachmentRow): EmailAttachmentSnapshot {
  return {
    id: row.id,
    emailId: row.email_id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    pathOnDisk: row.path_on_disk,
    createdAt: new Date(row.created_at),
  };
}

export class SqliteEmailRepository implements IEmailRepository {
  constructor(private readonly db: Database) {}

  // ---------- emails ----------

  async listByProject(projectId: ProjectId): Promise<EmailSnapshot[]> {
    const rows = this.db.query<EmailRow>(
      `SELECT id, project_id, subject, body, to_json, cc_json, status,
              created_at, updated_at, sent_at, failed_at, error_message
       FROM emails
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: string): Promise<EmailSnapshot | null> {
    const row = this.db.queryRow<EmailRow>(
      `SELECT id, project_id, subject, body, to_json, cc_json, status,
              created_at, updated_at, sent_at, failed_at, error_message
       FROM emails WHERE id = ?`,
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async create(args: CreateEmailArgs): Promise<DomainResult<EmailSnapshot>> {
    const id = args.id ?? crypto.randomUUID();
    const now = args.createdAt;
    try {
      this.db.run(
        `INSERT INTO emails
           (id, project_id, subject, body, to_json, cc_json, status, created_at, updated_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
        [
          id,
          args.projectId,
          args.subject ?? "",
          args.body ?? "",
          serializeAddresses(args.to ?? []),
          serializeAddresses(args.cc ?? []),
          now.toISOString(),
          now.toISOString(),
        ],
      );
      const snap = await this.findById(id);
      if (!snap) return domainErr("INTERNAL", "email disappeared after insert");
      return domainOk(snap);
    } catch (e) {
      return domainErr(
        "INTERNAL",
        `create email failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async updateDraft(
    id: string,
    args: UpdateEmailArgs,
    updatedAt: Date,
  ): Promise<DomainResult<EmailSnapshot>> {
    const existing = await this.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `email ${id} not found`);
    if (existing.status !== "draft") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot edit email in status=${existing.status}`,
      );
    }
    const fields: string[] = [];
    const params: (string | number)[] = [];
    if (args.subject !== undefined) {
      fields.push("subject = ?");
      params.push(args.subject);
    }
    if (args.body !== undefined) {
      fields.push("body = ?");
      params.push(args.body);
    }
    if (args.to !== undefined) {
      fields.push("to_json = ?");
      params.push(serializeAddresses(args.to));
    }
    if (args.cc !== undefined) {
      fields.push("cc_json = ?");
      params.push(serializeAddresses(args.cc));
    }
    fields.push("updated_at = ?");
    params.push(updatedAt.toISOString());
    params.push(id);
    this.db.run(
      `UPDATE emails SET ${fields.join(", ")} WHERE id = ?`,
      params,
    );
    const snap = await this.findById(id);
    if (!snap) return domainErr("INTERNAL", "email disappeared after update");
    return domainOk(snap);
  }

  async markSent(id: string, sentAt: Date): Promise<DomainResult<EmailSnapshot>> {
    const existing = await this.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `email ${id} not found`);
    if (existing.status !== "draft") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot send email in status=${existing.status}`,
      );
    }
    this.db.run(
      `UPDATE emails SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`,
      [sentAt.toISOString(), sentAt.toISOString(), id],
    );
    const snap = await this.findById(id);
    if (!snap) return domainErr("INTERNAL", "email disappeared after mark sent");
    return domainOk(snap);
  }

  async markFailed(id: string, failedAt: Date, errorMessage: string): Promise<DomainResult<EmailSnapshot>> {
    const existing = await this.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `email ${id} not found`);
    if (existing.status !== "draft") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot mark failed email in status=${existing.status}`,
      );
    }
    this.db.run(
      `UPDATE emails SET status = 'failed', failed_at = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      [failedAt.toISOString(), errorMessage.slice(0, 1000), failedAt.toISOString(), id],
    );
    const snap = await this.findById(id);
    if (!snap) return domainErr("INTERNAL", "email disappeared after mark failed");
    return domainOk(snap);
  }

  // ---------- attachments ----------

  async listAttachments(emailId: string): Promise<EmailAttachmentSnapshot[]> {
    const rows = this.db.query<AttachmentRow>(
      `SELECT id, email_id, filename, mime, size, path_on_disk, created_at
       FROM email_attachments WHERE email_id = ? ORDER BY created_at ASC`,
      [emailId],
    );
    return rows.map(rowToAttachment);
  }

  async findAttachment(id: string): Promise<EmailAttachmentSnapshot | null> {
    const row = this.db.queryRow<AttachmentRow>(
      `SELECT id, email_id, filename, mime, size, path_on_disk, created_at
       FROM email_attachments WHERE id = ?`,
      [id],
    );
    return row ? rowToAttachment(row) : null;
  }

  async addAttachment(
    args: AddAttachmentArgs,
  ): Promise<DomainResult<EmailAttachmentSnapshot>> {
    const email = await this.findById(args.emailId);
    if (!email) return domainErr("NOT_FOUND", `email ${args.emailId} not found`);
    if (email.status !== "draft") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot add attachment to email in status=${email.status}`,
      );
    }
    const id = args.id ?? crypto.randomUUID();
    try {
      this.db.run(
        `INSERT INTO email_attachments
           (id, email_id, filename, mime, size, path_on_disk, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          args.emailId,
          args.filename,
          args.mime,
          args.size,
          args.pathOnDisk,
          args.createdAt.toISOString(),
        ],
      );
      const snap = await this.findAttachment(id);
      if (!snap) return domainErr("INTERNAL", "attachment disappeared after insert");
      return domainOk(snap);
    } catch (e) {
      return domainErr(
        "INTERNAL",
        `add attachment failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async removeAttachment(id: string): Promise<DomainResult<void>> {
    const r = this.db.run("DELETE FROM email_attachments WHERE id = ?", [id]);
    if (r.changes === 0) return domainErr("NOT_FOUND", `attachment ${id} not found`);
    return domainOk(undefined);
  }
}