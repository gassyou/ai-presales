/**
 * MailAccountsSetting —— 阶段 7.4h
 *
 * SMTP 账号集合的领域 VO；纯函数 + 内置校验。
 *
 * 校验：
 *   - accounts 非空（用户可在 UI 删除到 0 → 业务上保留 1 个 stub 也行；这里强制非空）
 *   - 每个账号 id 唯一
 *   - 多账号时至少一个 isDefault
 *   - 每个账号：host/username/fromAddress 非空，port ∈ [1, 65535]，ssl ∈ {none,tls,starttls}
 *   - fromAddress 是合法 email（粗略正则即可 —— 严格 RFC 不必要）
 */

import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";

export type SslMode = "none" | "tls" | "starttls";

export interface MailAccount {
  readonly id: string;
  readonly displayName: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;  // 明文（用户接受）
  readonly fromAddress: string;
  readonly ssl: SslMode;
  readonly isDefault: boolean;
}

export interface MailAccountsSettingData {
  readonly accounts: readonly MailAccount[];
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class MailAccountsSetting {
  private constructor(private readonly data: MailAccountsSettingData) {}

  static create(input: MailAccountsSettingData): DomainResult<MailAccountsSetting> {
    if (!input || !Array.isArray(input.accounts)) {
      return domainErr("INVALID_INPUT", "accounts must be an array");
    }
    if (input.accounts.length === 0) {
      return domainErr("INVALID_INPUT", "at least one mail account is required");
    }
    const seenIds = new Set<string>();
    let defaultCount = 0;
    for (const a of input.accounts) {
      if (!a.id || !ID_PATTERN.test(a.id)) {
        return domainErr("INVALID_INPUT", `invalid mail account id: ${a.id}`);
      }
      if (seenIds.has(a.id)) {
        return domainErr("INVALID_INPUT", `duplicate mail account id: ${a.id}`);
      }
      seenIds.add(a.id);
      if (!a.host || a.host.length === 0) {
        return domainErr("INVALID_INPUT", `account ${a.id}: host is required`);
      }
      if (typeof a.port !== "number" || a.port < 1 || a.port > 65535) {
        return domainErr("INVALID_INPUT", `account ${a.id}: port must be in [1,65535]`, { port: a.port });
      }
      if (!a.username || a.username.length === 0) {
        return domainErr("INVALID_INPUT", `account ${a.id}: username is required`);
      }
      if (typeof a.password !== "string" || a.password.length === 0) {
        return domainErr("INVALID_INPUT", `account ${a.id}: password is required`);
      }
      if (!a.fromAddress || !EMAIL_RE.test(a.fromAddress)) {
        return domainErr("INVALID_INPUT", `account ${a.id}: fromAddress must be a valid email`, { fromAddress: a.fromAddress });
      }
      if (a.ssl !== "none" && a.ssl !== "tls" && a.ssl !== "starttls") {
        return domainErr("INVALID_INPUT", `account ${a.id}: ssl must be none|tls|starttls`, { ssl: a.ssl });
      }
      if (!a.displayName || a.displayName.length === 0) {
        return domainErr("INVALID_INPUT", `account ${a.id}: displayName is required`);
      }
      if (a.isDefault) defaultCount++;
    }
    if (input.accounts.length > 1 && defaultCount === 0) {
      return domainErr("INVALID_INPUT", "multiple accounts but no isDefault=true");
    }
    if (defaultCount > 1) {
      return domainErr("INVALID_INPUT", "only one account can be isDefault=true");
    }
    return domainOk(new MailAccountsSetting({
      accounts: Object.freeze(input.accounts.map((a) => ({ ...a }))),
    }));
  }

  get accounts(): readonly MailAccount[] {
    return this.data.accounts;
  }

  toJSON(): MailAccountsSettingData {
    return {
      accounts: this.data.accounts.map((a) => ({ ...a })),
    };
  }
}