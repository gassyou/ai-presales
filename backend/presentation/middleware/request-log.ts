/**
 * 请求日志中间件 —— 记录 method/path/status/duration
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export function requestLogMiddleware(logger: Logger) {
  return async (req: Request, next: () => Promise<Response>): Promise<Response> => {
    const started = performance.now();
    const res = await next();
    const durationMs = Math.round(performance.now() - started);
    const url = new URL(req.url);
    logger.info("req", {
      method: req.method,
      path: url.pathname,
      status: res.status,
      durationMs,
    });
    return res;
  };
}