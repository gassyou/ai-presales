/**
 * MailUseCase —— 邮件 + 附件用例编排
 *
 * 阶段 7.4e（.eml 落盘）→ 7.4h（接 SMTP 真实发送）。
 *
 * 用例：
 *   - createDraft / updateDraft / get / listByProject
 *   - send（用 system_settings 中的 mail account SMTP 发送；失败记 status=failed）
 *   - addAttachment / removeAttachment / listAttachments / downloadAttachment（bytes）
 *
 * 状态机：draft → sent | failed；sent/failed 之后所有写操作拒绝。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type {
  IEmailRepository,
  AddAttachmentArgs,
  CreateEmailArgs,
  UpdateEmailArgs,
} from "@backend/domain/mail/email.repository.ts";
import {
  type Address,
  type EmailAttachmentSnapshot,
  type EmailSnapshot,
  canEdit,
  canSend,
} from "@backend/domain/mail/email.ts";
import type { FilesystemMailStorage } from "./mail.storage.ts";
import { sanitizeFilename } from "./filename.ts";
import type { ISystemSettingRepository } from "@backend/domain/settings/system-setting.repository.ts";
import { MailAccountsSetting } from "@backend/domain/settings/mail-accounts.setting.ts";
import { pickMailAccount } from "@backend/application/settings/mail-account-resolver.ts";
import { createSmtpTransport, SmtpTransportError } from "@backend/infrastructure/mail/smtp-transport.ts";

export interface MailUseCaseDeps {
  repo: IEmailRepository;
  storage: FilesystemMailStorage;
  clock?: Clock;
  logger?: Logger;
  /** 阶段 7.4h：注入 settings repo；不传则回退到 .eml 落盘模式 */
  settings?: ISystemSettingRepository;
  /** 测试覆盖：注入 fake SMTP 工厂 */
  smtpFactory?: typeof createSmtpTransport;
  /** 测试用：覆盖 sanitizeFilename 的随机前缀（保持可重放） */
  fixedPrefix?: () => string;
}

export class MailUseCase {
  private readonly repo: IEmailRepository;
  private readonly storage: FilesystemMailStorage;
  private readonly clock: Clock;
  private readonly logger: Logger | undefined;
  private readonly settings: ISystemSettingRepository | undefined;
  private readonly smtpFactory: typeof createSmtpTransport | undefined;
  private readonly fixedPrefix: (() => string) | undefined;

  constructor(deps: MailUseCaseDeps) {
    this.repo = deps.repo;
    this.storage = deps.storage;
    this.clock = deps.clock ?? new SystemClock();
    this.logger = deps.logger;
    this.settings = deps.settings;
    this.smtpFactory = deps.smtpFactory;
    this.fixedPrefix = deps.fixedPrefix;
  }

  // ---------- emails ----------

  async createDraft(input: CreateEmailArgs): Promise<DomainResult<EmailSnapshot>> {
    const args: CreateEmailArgs = {
      ...input,
      createdAt: input.createdAt ?? this.clock.now(),
    };
    return await this.repo.create(args);
  }

  async updateDraft(id: string, args: UpdateEmailArgs): Promise<DomainResult<EmailSnapshot>> {
    const existing = await this.repo.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `email ${id} not found`);
    if (!canEdit(existing.status)) {
      return domainErr("ILLEGAL_STATE_TRANSITION",
        `cannot edit email in status=${existing.status}`,
        { status: existing.status });
    }
    return await this.repo.updateDraft(id, args, this.clock.now());
  }

  async get(id: string): Promise<DomainResult<EmailSnapshot>> {
    const snap = await this.repo.findById(id);
    if (!snap) return domainErr("NOT_FOUND", `email ${id} not found`);
    return domainOk(snap);
  }

  async listByProject(projectId: ProjectId): Promise<EmailSnapshot[]> {
    return await this.repo.listByProject(projectId);
  }

  async send(id: string, accountId?: string): Promise<DomainResult<EmailSnapshot>> {
    const snap = await this.repo.findById(id);
    if (!snap) return domainErr("NOT_FOUND", `email ${id} not found`);
    if (!canSend(snap.status)) {
      return domainErr("ILLEGAL_STATE_TRANSITION",
        `cannot send email in status=${snap.status}`,
        { status: snap.status });
    }

    // 阶段 7.4h：有 settings + 有 SMTP 工厂 → 走真实 SMTP；否则回退到 .eml 落盘
    if (this.settings && this.smtpFactory) {
      const account = await this.resolveAccount(accountId);
      if (!account) {
        return domainErr("INVALID_INPUT", "no mail account configured; please set up SMTP account in 系统设置");
      }
      try {
        const transport = this.smtpFactory(account);
        const attRows = await this.repo.listAttachments(snap.id);
        const attachments: Array<{ filename: string; mime: string; bytes: Uint8Array }> = [];
        for (const a of attRows) {
          const bytes = await this.storage.readAttachment(a.pathOnDisk);
          attachments.push({ filename: a.filename, mime: a.mime, bytes });
        }
        const result = await transport.send({
          from: account.fromAddress,
          to: snap.to,
          cc: snap.cc,
          subject: snap.subject,
          body: snap.body,
          attachments,
        });
        this.logger?.info("email sent via SMTP", { id: snap.id, account: account.id, messageId: result.messageId });
        return await this.repo.markSent(id, this.clock.now());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger?.error("SMTP send failed", { id: snap.id, account: account.id, error: msg });
        const failedAt = this.clock.now();
        const failedR = await this.repo.markFailed(id, failedAt, msg);
        if (!failedR.ok) return failedR;
        return domainErr("INTERNAL", `SMTP send failed: ${msg}`);
      }
    }

    // 回退路径：写 .eml（向后兼容旧测试）
    const eml = renderEml(snap);
    const path = await this.storage.writeEml(
      snap.projectId,
      snap.id,
      new TextEncoder().encode(eml),
    );
    this.logger?.info("email sent (mock)", { id: snap.id, path });
    return await this.repo.markSent(id, this.clock.now());
  }

  private async resolveAccount(accountId?: string): Promise<import("@backend/domain/settings/mail-accounts.setting.ts").MailAccount | null> {
    if (!this.settings) return null;
    const row = await this.settings.getMailAccounts();
    if (!row) return null;
    const setting = MailAccountsSetting.create(row.value);
    if (!setting.ok) return null;
    return pickMailAccount(setting.value.accounts, accountId);
  }

  // ---------- attachments ----------

  async addAttachment(input: {
    emailId: string;
    filename: string;
    mime: string;
    bytes: Uint8Array;
  }): Promise<DomainResult<EmailAttachmentSnapshot>> {
    const email = await this.repo.findById(input.emailId);
    if (!email) return domainErr("NOT_FOUND", `email ${input.emailId} not found`);
    if (!canEdit(email.status)) {
      return domainErr("ILLEGAL_STATE_TRANSITION",
        `cannot add attachment to email in status=${email.status}`,
        { status: email.status });
    }
    let safe: string;
    try {
      // 测试覆盖：fixedPrefix → 不加随机时间戳，直接用 sanitizeFilename 输出
      safe = this.fixedPrefix
        ? sanitizeFilename(input.filename).replace(/^[\w-]+-[\w-]+-/, "")
        : sanitizeFilename(input.filename);
    } catch (e) {
      return domainErr("INVALID_INPUT", e instanceof Error ? e.message : String(e));
    }
    const root = await this.storage.emailRoot(email.projectId, email.id);
    const path = this.storage.attachmentPath(root, safe);
    await this.storage.writeAttachment(path, input.bytes);
    const args: AddAttachmentArgs = {
      emailId: email.id,
      filename: safe,
      mime: input.mime,
      size: input.bytes.byteLength,
      pathOnDisk: path,
      createdAt: this.clock.now(),
    };
    return await this.repo.addAttachment(args);
  }

  async removeAttachment(attachmentId: string): Promise<DomainResult<void>> {
    const att = await this.repo.findAttachment(attachmentId);
    if (!att) return domainErr("NOT_FOUND", `attachment ${attachmentId} not found`);
    const r = await this.repo.removeAttachment(attachmentId);
    if (!r.ok) return r;
    // 物理删除（best-effort）
    try {
      await Deno.remove(att.pathOnDisk);
    } catch {
      // 文件可能已被外部清理；忽略
    }
    return domainOk(undefined);
  }

  async listAttachments(emailId: string): Promise<DomainResult<EmailAttachmentSnapshot[]>> {
    const email = await this.repo.findById(emailId);
    if (!email) return domainErr("NOT_FOUND", `email ${emailId} not found`);
    return domainOk(await this.repo.listAttachments(emailId));
  }

  async downloadAttachment(attachmentId: string): Promise<DomainResult<{
    attachment: EmailAttachmentSnapshot;
    bytes: Uint8Array;
  }>> {
    const att = await this.repo.findAttachment(attachmentId);
    if (!att) return domainErr("NOT_FOUND", `attachment ${attachmentId} not found`);
    // 防御：DB 路径必须解析到存储根目录下
    let bytes: Uint8Array;
    try {
      bytes = await this.storage.readAttachment(att.pathOnDisk);
    } catch (e) {
      return domainErr("INTERNAL",
        `read attachment failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return domainOk({ attachment: att, bytes });
  }
}

/** 最小 .eml 拼装（RFC 822 简化版）。 */
function renderEml(snap: EmailSnapshot): string {
  const lines: string[] = [];
  lines.push(`Message-ID: <${snap.id}@ai-presales.local>`);
  lines.push(`Date: ${(snap.sentAt ?? new Date()).toUTCString()}`);
  lines.push(`From: ai-presales@local`);
  lines.push(`To: ${joinAddresses(snap.to)}`);
  if (snap.cc.length > 0) lines.push(`Cc: ${joinAddresses(snap.cc)}`);
  lines.push(`Subject: ${snap.subject}`);
  lines.push(`Content-Type: text/plain; charset=utf-8`);
  lines.push("");
  lines.push(snap.body);
  return lines.join("\r\n");
}

function joinAddresses(addrs: readonly Address[]): string {
  return addrs
    .map((a) => (a.name ? `"${a.name}" <${a.email}>` : a.email))
    .join(", ");
}

// re-export for callers
export { SmtpTransportError } from "@backend/infrastructure/mail/smtp-transport.ts";