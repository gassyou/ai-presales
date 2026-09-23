/**
 * Settings Store —— 阶段 7.4h
 *
 * 4 个独立 slice + loadAll() 并行加载。
 * 乐观并发：update* 都接受 expectedUpdatedAt；返回 409 CONFLICT 时上层 UI 提示用户刷新。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import {
  settingsApi,
  type LLMProfilesReadDTO,
  type MailAccountsReadDTO,
  type ToolConfigsReadDTO,
  type SubAgentSpecsReadDTO,
  type LLMProfilesSettingDTO,
  type MailAccountsSettingDTO,
  type ToolConfigsSettingDTO,
  type SubAgentSpecsSettingDTO,
  type EmbeddingConfigReadDTO,
  type EmbeddingConfigSettingDTO,
  type MailAccountDTO,
  type ToolConfigValue,
} from "../api/settings.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

export const useSettingsStore = defineStore("settings", () => {
  const llmProfiles = ref<LLMProfilesReadDTO | null>(null);
  const mailAccounts = ref<MailAccountsReadDTO | null>(null);
  const toolConfigs = ref<ToolConfigsReadDTO | null>(null);
  const agentSpecs = ref<SubAgentSpecsReadDTO | null>(null);
  const embedding = ref<EmbeddingConfigReadDTO | null>(null);  // 阶段 7.7

  const loading = ref<string | null>(null);
  const error = ref<string | null>(null);

  async function loadAll(): Promise<void> {
    loading.value = "all";
    error.value = null;
    try {
      // 后端 /api/settings 把每个 setting 包成 { value, updatedAt }；这里拆开
      // 让 UI 直接拿到扁平形状（与 /api/settings/{x} 单点接口一致）。
      const snap = await settingsApi.getAll();
      llmProfiles.value = unwrap(snap.llmProfiles);
      mailAccounts.value = normalizeMail(snap.mailAccounts);
      toolConfigs.value = normalizeTool(snap.toolConfigs);
      agentSpecs.value = unwrap(snap.agentSpecs);
      embedding.value = unwrap(snap.embedding);
    } catch (e) {
      error.value = formatError(e);
    } finally {
      loading.value = null;
    }
  }

  async function loadLLMProfiles(): Promise<void> {
    loading.value = "llm";
    error.value = null;
    try {
      llmProfiles.value = await settingsApi.getLLMProfiles();
    } catch (e) {
      error.value = formatError(e);
    } finally {
      loading.value = null;
    }
  }

  async function loadMailAccounts(): Promise<void> {
    loading.value = "mail";
    error.value = null;
    try {
      mailAccounts.value = await settingsApi.getMailAccounts();
    } catch (e) {
      error.value = formatError(e);
    } finally {
      loading.value = null;
    }
  }

  async function loadToolConfigs(): Promise<void> {
    loading.value = "tools";
    error.value = null;
    try {
      toolConfigs.value = await settingsApi.getToolConfigs();
    } catch (e) {
      error.value = formatError(e);
    } finally {
      loading.value = null;
    }
  }

  async function loadAgentSpecs(): Promise<void> {
    loading.value = "agents";
    error.value = null;
    try {
      agentSpecs.value = await settingsApi.getAgentSpecs();
    } catch (e) {
      error.value = formatError(e);
    } finally {
      loading.value = null;
    }
  }

  async function saveLLMProfiles(
    body: LLMProfilesSettingDTO,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
    try {
      llmProfiles.value = await settingsApi.updateLLMProfiles(
        body,
        llmProfiles.value?.updatedAt,
      );
      return { ok: true };
    } catch (e) {
      const msg = formatError(e);
      const conflict = e instanceof ApiError && e.httpStatus === 409;
      error.value = msg;
      return { ok: false, conflict, error: msg };
    }
  }

  async function saveMailAccounts(
    body: MailAccountsSettingDTO,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
    try {
      mailAccounts.value = await settingsApi.updateMailAccounts(
        body,
        mailAccounts.value?.updatedAt,
      );
      return { ok: true };
    } catch (e) {
      const msg = formatError(e);
      const conflict = e instanceof ApiError && e.httpStatus === 409;
      error.value = msg;
      return { ok: false, conflict, error: msg };
    }
  }

  async function saveToolConfigs(
    body: ToolConfigsSettingDTO,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
    try {
      toolConfigs.value = await settingsApi.updateToolConfigs(
        body,
        toolConfigs.value?.updatedAt,
      );
      return { ok: true };
    } catch (e) {
      const msg = formatError(e);
      const conflict = e instanceof ApiError && e.httpStatus === 409;
      error.value = msg;
      return { ok: false, conflict, error: msg };
    }
  }

  async function saveAgentSpecs(
    body: SubAgentSpecsSettingDTO,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
    try {
      agentSpecs.value = await settingsApi.updateAgentSpecs(
        body,
        agentSpecs.value?.updatedAt,
      );
      return { ok: true };
    } catch (e) {
      const msg = formatError(e);
      const conflict = e instanceof ApiError && e.httpStatus === 409;
      error.value = msg;
      return { ok: false, conflict, error: msg };
    }
  }

  // ---- Embedding config (阶段 7.7) ----

  async function loadEmbeddingConfig(): Promise<void> {
    loading.value = "embedding";
    error.value = null;
    try {
      embedding.value = await settingsApi.getEmbeddingConfig();
    } catch (e) {
      error.value = formatError(e);
    } finally {
      loading.value = null;
    }
  }

  async function saveEmbeddingConfig(
    body: EmbeddingConfigSettingDTO,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
    try {
      embedding.value = await settingsApi.updateEmbeddingConfig(
        body,
        embedding.value?.updatedAt,
      );
      return { ok: true };
    } catch (e) {
      const msg = formatError(e);
      const conflict = e instanceof ApiError && e.httpStatus === 409;
      error.value = msg;
      return { ok: false, conflict, error: msg };
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    llmProfiles,
    mailAccounts,
    toolConfigs,
    agentSpecs,
    embedding,
    loading,
    error,
    loadAll,
    loadLLMProfiles,
    loadMailAccounts,
    loadToolConfigs,
    loadAgentSpecs,
    loadEmbeddingConfig,
    saveLLMProfiles,
    saveMailAccounts,
    saveToolConfigs,
    saveAgentSpecs,
    saveEmbeddingConfig,
    clearError,
  };
});

function formatError(e: unknown): string {
  if (e instanceof ApiError) return `${e.envelope.code}: ${e.envelope.message}`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * 后端 /api/settings 把每个 setting 包成 { value, updatedAt }，单点接口 /api/settings/{x}
 * 返扁平。这里在 snapshot 路径拆开，保持 UI 一致只面对扁平形状。
 *
 * 返回类型总是带 updatedAt（即使 wrapped 没给也用当前时间兜底）。
 */
interface Unwrapped {
  updatedAt: string;
}
function unwrap<T extends object>(
  wrapped: unknown,
): (T & Unwrapped) | null {
  if (!wrapped || typeof wrapped !== "object") return null;
  const w = wrapped as { value?: unknown; updatedAt?: string };
  const v = w.value;
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") return null;
  const updatedAt = typeof w.updatedAt === "string" ? w.updatedAt : new Date().toISOString();
  return { ...(v as object), updatedAt } as T & Unwrapped;
}

/** 后端无账号时返 {accounts: null}，UI 期望 [] */
function normalizeMail(wrapped: unknown): MailAccountsReadDTO | null {
  const inner = unwrap<{ accounts?: MailAccountDTO[] | null }>(wrapped);
  if (!inner) return null;
  return {
    accounts: Array.isArray(inner.accounts) ? inner.accounts : [],
    updatedAt: inner.updatedAt,
  };
}

/** 后端无 tool 时返 {configs: {}} 或 null，UI 期望 configs: Record<string, ToolConfigValue> */
function normalizeTool(wrapped: unknown): ToolConfigsReadDTO | null {
  const inner = unwrap<{ configs?: Record<string, ToolConfigValue> }>(wrapped);
  if (!inner) return null;
  return {
    configs: inner.configs ?? {},
    updatedAt: inner.updatedAt,
  };
}