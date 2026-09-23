/**
 * 全局错误处理中间件
 *
 * 把任何 throw / reject 转成 ErrorEnvelope JSON 响应。
 * 与 ErrorCode 枚举配合使用。
 */

import type { ErrorEnvelope, ErrorCodeValue } from "@shared/types/common.ts";
import { ErrorCode } from "@shared/types/common.ts";

/** 业务层可主动抛出的错误类型 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCodeValue,
    message: string,
    readonly httpStatus: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** 工厂：常用错误 */
export const Errors = {
  notFound: (what: string) => new AppError(ErrorCode.NOT_FOUND, `${what} 不存在`, 404),
  validation: (msg: string, details?: unknown) => new AppError(ErrorCode.VALIDATION_FAILED, msg, 400, details),
  conflict: (msg: string) => new AppError(ErrorCode.CONFLICT, msg, 409),
  internal: (msg = "Internal Server Error") => new AppError(ErrorCode.INTERNAL, msg, 500),
  llmAuth: (msg = "LLM 认证失败，请检查 API Key") => new AppError(ErrorCode.LLM_AUTH_FAILED, msg, 502),
  llmUpstream: (msg = "LLM 上游错误") => new AppError(ErrorCode.LLM_UPSTREAM_ERROR, msg, 502),
  aborted: (msg = "操作已取消") => new AppError(ErrorCode.ABORTED, msg, 499),
};

let counter = 0;
function nextTraceId(): string {
  counter = (counter + 1) & 0xffff;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** ErrorEnvelope 化 */
export function toErrorEnvelope(err: unknown, traceId: string): { body: ErrorEnvelope; status: number } {
  if (err instanceof AppError) {
    return {
      body: {
        code: err.code,
        message: err.message,
        details: err.details,
        traceId,
      },
      status: err.httpStatus,
    };
  }
  return {
    body: {
      code: ErrorCode.INTERNAL,
      message: err instanceof Error ? err.message : String(err),
      traceId,
    },
    status: 500,
  };
}

/** errorHandler 中间件：包裹下一个 handler，捕获所有 throw */
export async function errorHandler(req: Request, next: () => Promise<Response>): Promise<Response> {
  const traceId = req.headers.get("x-trace-id") ?? nextTraceId();
  try {
    const res = await next();
    // 把 traceId 回填到响应头，便于客户端关联
    res.headers.set("x-trace-id", traceId);
    return res;
  } catch (e) {
    const { body, status } = toErrorEnvelope(e, traceId);
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-trace-id": traceId,
      },
    });
  }
}