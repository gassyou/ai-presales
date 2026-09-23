/**
 * Result<T, E> —— 用返回值代替异常
 *
 * 领域层禁止 throw。错误以 Result 形式传出去，presentation 层做映射。
 *
 * 模式：
 *   const r = Project.create(input);
 *   if (!r.ok) return r;                       // 透传
 *   const p = r.value;
 *   const r2 = p.rename(newName);
 *   if (!r2.ok) throw new ValidationError(r2.error);
 *
 * 命名约定：领域方法返回 `DomainResult<T>`（错误用 DomainError）；presentation 决定怎么渲染。
 */

import type { Result } from "@shared/types/common.ts";

export type { Result } from "@shared/types/common.ts";
export { ok, err } from "@shared/types/common.ts";

/** 领域错误码 —— 比 common.ts 的 ErrorCode 更细；presentation 决定如何映射 */
export type DomainErrorCode =
  | "INVALID_INPUT"
  | "INVARIANT_VIOLATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ILLEGAL_STATE_TRANSITION"
  | "INTERNAL";

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type DomainResult<T> = Result<T, DomainError>;

export const domainOk = <T>(value: T): DomainResult<T> => ({ ok: true, value });
export const domainErr = (
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DomainResult<never> => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
});