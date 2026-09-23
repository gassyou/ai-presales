/**
 * 通用 DTO 与错误类型
 */

/** 统一错误信封 */
export interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
  traceId: string;
}

/** 业务错误码 */
export const ErrorCode = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL: "INTERNAL",
  LLM_AUTH_FAILED: "LLM_AUTH_FAILED",
  LLM_RATE_LIMIT: "LLM_RATE_LIMIT",
  LLM_UPSTREAM_ERROR: "LLM_UPSTREAM_ERROR",
  LLM_CONTEXT_OVERFLOW: "LLM_CONTEXT_OVERFLOW",
  EXTENSION_MISSING: "EXTENSION_MISSING",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  ABORTED: "ABORTED",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Result<T, E> —— 领域层用返回值代替异常 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** 分页参数 */
export interface PageRequest {
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: readonly T[];
  total: number;
  limit: number;
  offset: number;
}

/** ISO-8601 时间字符串（前后端均按 string 传，避免 Date 反序列化歧义） */
export type IsoDateTime = string;