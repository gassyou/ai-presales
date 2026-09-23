/**
 * HTTP 客户端 —— fetch 薄封装
 *
 * - 自动 JSON 编解码
 * - 解析 ErrorEnvelope，抛 ApiError
 * - 不暴露 fetch 细节给业务方
 */

import type { ErrorEnvelope } from "@shared/types/common.ts";

export class ApiError extends Error {
  constructor(
    readonly envelope: ErrorEnvelope,
    readonly httpStatus: number,
  ) {
    super(`${envelope.code}: ${envelope.message}`);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...opts.headers,
  };

  const init: RequestInit = {
    method,
    headers,
    signal: opts.signal,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const url = buildUrl(path, opts.query);
  const res = await fetch(url, init);

  if (!res.ok) {
    let envelope: ErrorEnvelope;
    try {
      envelope = await res.json() as ErrorEnvelope;
    } catch {
      envelope = {
        code: "INTERNAL",
        message: `HTTP ${res.status}`,
        traceId: res.headers.get("x-trace-id") ?? "",
      };
    }
    throw new ApiError(envelope, res.status);
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return await res.json() as T;
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PUT", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PATCH", path, body, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, undefined, opts),
};