/**
 * Settings API —— 阶段 7.4h
 *
 * 4 类系统设置（LLM profiles / mail accounts / tool configs / agent specs）的 typed client。
 * 后端对应：backend/presentation/routes/settings.route.ts。
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";

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

// ---- Tool configs ----

export type ToolConfigValue = Record<string, unknown>;

export interface ToolConfigsSettingDTO {
  configs: Record<string, ToolConfigValue>;
}

export interface ToolConfigsReadDTO {
  configs: Record<string, ToolConfigValue>;
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
  toolConfigs: ToolConfigsReadDTO | null;
  agentSpecs: SubAgentSpecsReadDTO | null;
  embedding: EmbeddingConfigReadDTO | null;  // 阶段 7.7
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

  getToolConfigs() {
    return http.get<ToolConfigsReadDTO>(Endpoints.settingsToolConfigs);
  },
  updateToolConfigs(
    body: ToolConfigsSettingDTO,
    expectedUpdatedAt?: string,
  ) {
    return http.put<ToolConfigsReadDTO>(
      Endpoints.settingsToolConfigs,
      expectedUpdatedAt ? { ...body, expectedUpdatedAt } : body,
    );
  },

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