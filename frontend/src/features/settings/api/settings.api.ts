/**
 * Settings API —— 阶段 7.4h
 *
 * 4 类系统设置（LLM profiles / mail accounts / tool configs / agent specs）的 typed client。
 * 后端对应：backend/presentation/routes/settings.route.ts。
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";
import type {
  CreateUserSubAgentInput,
  UpdateUserSubAgentInput,
} from "@shared/types/dto/sub-agent.ts";

// ---- LLM profiles ----

export type LLMProvider = "anthropic" | "openai";

export interface LLMProfileConfigDTO {
  name: string;
  provider: LLMProvider;
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface LLMProfilesSettingDTO {
  defaultProfile: string;
  profiles: LLMProfileConfigDTO[];
}

export interface LLMProfilesReadDTO {
  defaultProfile: string;
  profiles: LLMProfileConfigDTO[];
  updatedAt: string;
}

// ---- Mail accounts ----

export type MailSSLMode = "none" | "tls" | "starttls";

export interface MailAccountDTO {
  id: string;
  displayName: string;
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  ssl: MailSSLMode;
  isDefault: boolean;
}

export interface MailAccountsSettingDTO {
  accounts: MailAccountDTO[];
}

export interface MailAccountsReadDTO {
  accounts: MailAccountDTO[];
  updatedAt: string;
}

// ---- Sub-agent specs ----

export interface SubAgentSpecDTO {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  toolNames: string[];
  profileHint?: string;
  /** 阶段 13（PR #3）：system = 内置不可改；user = 用户可编辑/删除 */
  type: "system" | "user";
}

export interface SubAgentSpecsSettingDTO {
  specs: Record<string, SubAgentSpecDTO>;
}

export interface SubAgentSpecsReadDTO {
  specs: Record<string, SubAgentSpecDTO>;
  updatedAt: string;
}

// ---- All-settings snapshot ----

export interface SettingsSnapshotDTO {
  llmProfiles: LLMProfilesReadDTO | null;
  mailAccounts: MailAccountsReadDTO | null;
  // 阶段 3：toolConfigs 字段从前端 snapshot 删除（用户取消 UI 设置入口）
  agentSpecs: SubAgentSpecsReadDTO | null;
  embedding: EmbeddingConfigReadDTO | null; // 阶段 7.7
}

// ---- API ----

export const settingsApi = {
  getAll() {
    return http.get<SettingsSnapshotDTO>(Endpoints.settingsAll);
  },

  getLLMProfiles() {
    return http.get<LLMProfilesReadDTO>(Endpoints.settingsLlmProfiles);
  },
  updateLLMProfiles(
    body: LLMProfilesSettingDTO,
    expectedUpdatedAt?: string,
  ) {
    return http.put<LLMProfilesReadDTO>(
      Endpoints.settingsLlmProfiles,
      expectedUpdatedAt ? { ...body, expectedUpdatedAt } : body,
    );
  },

  getMailAccounts() {
    return http.get<MailAccountsReadDTO>(Endpoints.settingsMailAccounts);
  },
  updateMailAccounts(
    body: MailAccountsSettingDTO,
    expectedUpdatedAt?: string,
  ) {
    return http.put<MailAccountsReadDTO>(
      Endpoints.settingsMailAccounts,
      expectedUpdatedAt ? { ...body, expectedUpdatedAt } : body,
    );
  },

  // 阶段 3：删除 getToolConfigs / updateToolConfigs（用户取消 UI 入口；后端保留向后兼容）
  getAgentSpecs() {
    return http.get<SubAgentSpecsReadDTO>(Endpoints.settingsAgentSpecs);
  },
  updateAgentSpecs(
    body: SubAgentSpecsSettingDTO,
    expectedUpdatedAt?: string,
  ) {
    return http.put<SubAgentSpecsReadDTO>(
      Endpoints.settingsAgentSpecs,
      expectedUpdatedAt ? { ...body, expectedUpdatedAt } : body,
    );
  },
  // 阶段 13（PR #3）：单条 user sub-agent CRUD
  createAgentSpec(input: CreateUserSubAgentInput) {
    return http.post<SubAgentSpecsReadDTO>(Endpoints.settingsAgentSpecs, input);
  },
  updateAgentSpec(name: string, input: UpdateUserSubAgentInput) {
    return http.patch<SubAgentSpecsReadDTO>(
      `${Endpoints.settingsAgentSpecs}/${encodeURIComponent(name)}`,
      input,
    );
  },
  deleteAgentSpec(name: string) {
    return http.del<void>(`${Endpoints.settingsAgentSpecs}/${encodeURIComponent(name)}`);
  },

  // ---- Embedding config (阶段 7.7) ----

  getEmbeddingConfig() {
    return http.get<EmbeddingConfigReadDTO>(Endpoints.settingsEmbedding);
  },
  updateEmbeddingConfig(
    body: EmbeddingConfigSettingDTO,
    expectedUpdatedAt?: string,
  ) {
    return http.put<EmbeddingConfigReadDTO>(
      Endpoints.settingsEmbedding,
      expectedUpdatedAt ? { ...body, expectedUpdatedAt } : body,
    );
  },
};

// ---- Embedding config types (阶段 7.7) ----

export type EmbeddingProviderName = "ollama" | "openai" | "dashscope" | "mock";

export interface EmbeddingConfigSettingDTO {
  provider: EmbeddingProviderName;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  dimension: number;
  textType?: "query" | "document";
}

export interface EmbeddingConfigReadDTO extends EmbeddingConfigSettingDTO {
  updatedAt: string;
}
