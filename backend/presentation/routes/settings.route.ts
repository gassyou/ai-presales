/**
 * settings.route —— 阶段 7.4h；阶段 7.7 加 embedding 端点
 *
 * 端点（5 组，每组 GET + PUT）：
 *   GET  /api/settings/llm-profiles         → { defaultProfile, profiles, updatedAt }
 *   PUT  /api/settings/llm-profiles         → body 同上；后端写盘 + hot-reload
 *   GET  /api/settings/mail-accounts        → { accounts, updatedAt }
 *   PUT  /api/settings/mail-accounts
 *   GET  /api/settings/tool-configs         → { configs, updatedAt }
 *   PUT  /api/settings/tool-configs
 *   GET  /api/settings/agent-specs          → { specs, updatedAt }
 *   PUT  /api/settings/agent-specs
 *   GET  /api/settings/embedding            → { provider, baseUrl, apiKey, model, dimension, updatedAt }
 *   PUT  /api/settings/embedding
 *
 * 乐观并发：PUT body 可选带 expectedUpdatedAt；不匹配 → 409 CONFLICT
 *
 * 设计：
 *   - 端点无 service 注入时返回 501
 *   - PUT 写完触发 settings usecase 的 hot-reload callback
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { SettingsUseCase } from "@backend/application/settings/settings.usecase.ts";
import type { LLMProfileConfig } from "@backend/domain/settings/llm-profiles.setting.ts";
import type { MailAccount } from "@backend/domain/settings/mail-accounts.setting.ts";
import type { SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import type { EmbeddingConfigSettingData } from "@backend/domain/settings/embedding-config.setting.ts";

export interface SettingsRouteDeps {
  logger: Logger;
  useCase: SettingsUseCase;
}

export async function handleSettings(
  req: Request,
  deps: SettingsRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // GET 全部（一次性拉全集）
  if (path === "/api/settings" && method === "GET") {
    try {
      const snap = await deps.useCase.snapshotAll();
      return jsonOk({
        llmProfiles: snap.llmProfiles,
        mailAccounts: snap.mailAccounts,
        toolConfigs: snap.toolConfigs,
        agentSpecs: snap.agentSpecs,
        embedding: snap.embedding ?? null,
      });
    } catch (e) {
      return jsonErr(deps.logger, "settings.snapshot failed", e);
    }
  }

  if (path === "/api/settings/llm-profiles") {
    if (method === "GET") return await getLLMProfiles(deps);
    if (method === "PUT") return await updateLLMProfiles(req, deps);
    return jsonError(405, "INVALID_INPUT", `method ${method} not allowed`);
  }
  if (path === "/api/settings/mail-accounts") {
    if (method === "GET") return await getMailAccounts(deps);
    if (method === "PUT") return await updateMailAccounts(req, deps);
    return jsonError(405, "INVALID_INPUT", `method ${method} not allowed`);
  }
  if (path === "/api/settings/tool-configs") {
    if (method === "GET") return await getToolConfigs(deps);
    if (method === "PUT") return await updateToolConfigs(req, deps);
    return jsonError(405, "INVALID_INPUT", `method ${method} not allowed`);
  }
  if (path === "/api/settings/agent-specs") {
    if (method === "GET") return await getAgentSpecs(deps);
    if (method === "PUT") return await updateAgentSpecs(req, deps);
    return jsonError(405, "INVALID_INPUT", `method ${method} not allowed`);
  }
  // 阶段 7.7：embedding provider 配置
  if (path === "/api/settings/embedding") {
    if (method === "GET") return await getEmbeddingConfig(deps);
    if (method === "PUT") return await updateEmbeddingConfig(req, deps);
    return jsonError(405, "INVALID_INPUT", `method ${method} not allowed`);
  }

  return jsonError(404, "NOT_FOUND", `route ${path} not found`);
}

async function getLLMProfiles(deps: SettingsRouteDeps): Promise<Response> {
  try {
    const snap = await deps.useCase.getLLMProfiles();
    return jsonOk({ defaultProfile: snap?.value.defaultProfile ?? null, profiles: snap?.value.profiles ?? null, updatedAt: snap?.updatedAt ?? null });
  } catch (e) {
    return jsonErr(deps.logger, "settings.getLLMProfiles failed", e);
  }
}

async function updateLLMProfiles(req: Request, deps: SettingsRouteDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonError(400, "INVALID_INPUT", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as {
    defaultProfile?: string;
    profiles?: LLMProfileConfig[];
    expectedUpdatedAt?: string;
  };
  if (!body.defaultProfile || !Array.isArray(body.profiles)) {
    return jsonError(400, "INVALID_INPUT", "defaultProfile and profiles are required");
  }
  try {
    const r = await deps.useCase.updateLLMProfiles(
      { defaultProfile: body.defaultProfile, profiles: body.profiles },
      body.expectedUpdatedAt,
    );
    if (!r.ok) return jsonErrorForDomain(r.error);
    return jsonOk({ defaultProfile: r.value.value.defaultProfile, profiles: r.value.value.profiles, updatedAt: r.value.updatedAt });
  } catch (e) {
    return jsonErr(deps.logger, "settings.updateLLMProfiles failed", e);
  }
}

async function getMailAccounts(deps: SettingsRouteDeps): Promise<Response> {
  try {
    const snap = await deps.useCase.getMailAccounts();
    return jsonOk({ accounts: snap?.value.accounts ?? null, updatedAt: snap?.updatedAt ?? null });
  } catch (e) {
    return jsonErr(deps.logger, "settings.getMailAccounts failed", e);
  }
}

async function updateMailAccounts(req: Request, deps: SettingsRouteDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonError(400, "INVALID_INPUT", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as {
    accounts?: MailAccount[];
    expectedUpdatedAt?: string;
  };
  if (!Array.isArray(body.accounts)) {
    return jsonError(400, "INVALID_INPUT", "accounts must be an array");
  }
  try {
    const r = await deps.useCase.updateMailAccounts(
      { accounts: body.accounts },
      body.expectedUpdatedAt,
    );
    if (!r.ok) return jsonErrorForDomain(r.error);
    return jsonOk({ accounts: r.value.value.accounts, updatedAt: r.value.updatedAt });
  } catch (e) {
    return jsonErr(deps.logger, "settings.updateMailAccounts failed", e);
  }
}

async function getToolConfigs(deps: SettingsRouteDeps): Promise<Response> {
  try {
    const snap = await deps.useCase.getToolConfigs();
    return jsonOk({ configs: snap?.value.configs ?? {}, updatedAt: snap?.updatedAt ?? null });
  } catch (e) {
    return jsonErr(deps.logger, "settings.getToolConfigs failed", e);
  }
}

async function updateToolConfigs(req: Request, deps: SettingsRouteDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonError(400, "INVALID_INPUT", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as {
    configs?: Record<string, Record<string, unknown>>;
    expectedUpdatedAt?: string;
  };
  if (!body.configs || typeof body.configs !== "object" || Array.isArray(body.configs)) {
    return jsonError(400, "INVALID_INPUT", "configs must be an object");
  }
  try {
    const r = await deps.useCase.updateToolConfigs(
      { configs: body.configs },
      body.expectedUpdatedAt,
    );
    if (!r.ok) return jsonErrorForDomain(r.error);
    return jsonOk({ configs: r.value.value.configs, updatedAt: r.value.updatedAt });
  } catch (e) {
    return jsonErr(deps.logger, "settings.updateToolConfigs failed", e);
  }
}

async function getAgentSpecs(deps: SettingsRouteDeps): Promise<Response> {
  try {
    const snap = await deps.useCase.getAgentSpecs();
    return jsonOk({ specs: snap?.value.specs ?? {}, updatedAt: snap?.updatedAt ?? null });
  } catch (e) {
    return jsonErr(deps.logger, "settings.getAgentSpecs failed", e);
  }
}

async function updateAgentSpecs(req: Request, deps: SettingsRouteDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonError(400, "INVALID_INPUT", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as {
    specs?: Record<string, SubAgentSpecData>;
    expectedUpdatedAt?: string;
  };
  if (!body.specs || typeof body.specs !== "object" || Array.isArray(body.specs)) {
    return jsonError(400, "INVALID_INPUT", "specs must be an object");
  }
  try {
    const r = await deps.useCase.updateAgentSpecs(
      { specs: body.specs },
      body.expectedUpdatedAt,
    );
    if (!r.ok) return jsonErrorForDomain(r.error);
    return jsonOk({ specs: r.value.value.specs, updatedAt: r.value.updatedAt });
  } catch (e) {
    return jsonErr(deps.logger, "settings.updateAgentSpecs failed", e);
  }
}

// ---------- helpers ----------

async function getEmbeddingConfig(deps: SettingsRouteDeps): Promise<Response> {
  try {
    const snap = await deps.useCase.getEmbeddingConfig();
    if (!snap) return jsonOk(null);
    return jsonOk({ ...snap.value, updatedAt: snap.updatedAt });
  } catch (e) {
    return jsonErr(deps.logger, "settings.getEmbeddingConfig failed", e);
  }
}

async function updateEmbeddingConfig(req: Request, deps: SettingsRouteDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return jsonError(400, "INVALID_INPUT", `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (raw ?? {}) as EmbeddingConfigSettingData & { expectedUpdatedAt?: string };
  if (!body.provider || !body.model) {
    return jsonError(400, "INVALID_INPUT", "provider and model are required");
  }
  try {
    const r = await deps.useCase.updateEmbeddingConfig(
      {
        provider: body.provider,
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.apiKey !== undefined ? { apiKey: body.apiKey } : {}),
        model: body.model,
        dimension: body.dimension,
        ...(body.textType !== undefined ? { textType: body.textType } : {}),
      },
      body.expectedUpdatedAt,
    );
    if (!r.ok) return jsonErrorForDomain(r.error);
    return jsonOk({ ...r.value.value, updatedAt: r.value.updatedAt });
  } catch (e) {
    return jsonErr(deps.logger, "settings.updateEmbeddingConfig failed", e);
  }
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string, message: string, details?: Record<string, unknown>): Response {
  return new Response(JSON.stringify(details ? { code, message, details } : { code, message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErrorForDomain(err: { code: string; message: string; details?: Record<string, unknown> }): Response {
  const status = err.code === "CONFLICT" ? 409
    : err.code === "NOT_FOUND" ? 404
    : err.code === "INVALID_INPUT" ? 400
    : err.code === "ILLEGAL_STATE_TRANSITION" ? 409
    : 500;
  return jsonError(status, err.code, err.message, err.details);
}

function jsonErr(logger: Logger, msg: string, e: unknown): Response {
  logger.error(msg, { error: e instanceof Error ? e.message : String(e) });
  return jsonError(500, "INTERNAL", msg);
}