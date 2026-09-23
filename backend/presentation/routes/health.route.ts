/**
 * GET /api/health
 *
 * 返回应用状态、版本、数据库状态、LLM 配置是否完整。
 * 用于：健康检查、启动期自检、前端"应用是否就绪"展示。
 */

import type { AppConfig } from "@backend/infrastructure/config/types.ts";

export interface HealthDeps {
  config: AppConfig;
  /** 数据库探针：返回 true 表示可读写 */
  dbProbe?: () => Promise<boolean>;
  /** LLM 探针：返回已配置的 provider 列表 */
  llmProbe?: () => Promise<{ ok: boolean; providers: readonly string[] }>;
}

export async function healthHandler(req: Request, deps: HealthDeps): Promise<Response> {
  const dbOk = deps.dbProbe ? await deps.dbProbe() : null;
  const llm = deps.llmProbe ? await deps.llmProbe() : { ok: true, providers: Object.keys(deps.config.profiles) };

  const body = {
    status: "ok",
    name: deps.config.app.name,
    version: deps.config.app.version,
    timestamp: new Date().toISOString(),
    checks: {
      db: dbOk === null ? "skipped" : dbOk ? "ok" : "fail",
      llm: llm.ok ? "ok" : "fail",
      providers: llm.providers,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}