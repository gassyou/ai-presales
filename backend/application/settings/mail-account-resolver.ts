/**
 * MailAccountResolver —— 阶段 7.4h
 *
 * 选 SMTP 账号的工具函数（纯函数 + 不依赖 DI）。
 *
 * 优先级：
 *   1. requestedId 显式匹配（UI 选具体账号）
 *   2. isDefault=true（多账号时仅一个）
 *   3. 唯一账号
 *   4. 否则 null
 */

import type { MailAccount } from "@backend/domain/settings/mail-accounts.setting.ts";

export function pickMailAccount(
  accounts: readonly MailAccount[],
  requestedId?: string,
): MailAccount | null {
  if (accounts.length === 0) return null;
  if (requestedId !== undefined) {
    const found = accounts.find((a) => a.id === requestedId);
    if (found) return found;
  }
  const def = accounts.find((a) => a.isDefault);
  if (def) return def;
  if (accounts.length === 1) return accounts[0];
  return null;
}