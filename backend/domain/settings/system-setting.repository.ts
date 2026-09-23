/**
 * SystemSetting 仓储接口 —— 阶段 7.4h
 *
 * 单表存储（system_settings），key=类别、value_json=全集序列化、updated_at 用于乐观并发。
 *
 * 类型化 convenience method：
 *   - getLLMProfiles() / setLLMProfiles(...) 等 —— 调用方无 type assertion
 *   - getRaw<T>(key) —— 逃生口：仅测试用
 */

import type { Clock } from "@backend/domain/shared/clock.ts";
import type { DomainResult } from "@backend/domain/shared/result.ts";
import type { LLMProfilesSettingData } from "./llm-profiles.setting.ts";
import type { MailAccountsSettingData } from "./mail-accounts.setting.ts";
import type { ToolConfigsSettingData } from "./tool-configs.setting.ts";
import type { SubAgentSpecsSettingData } from "./sub-agent-specs.setting.ts";
import type { EmbeddingConfigSettingData } from "./embedding-config.setting.ts";

/** 设置类别 key —— 强类型枚举，避免字符串拼错 */
export const SETTING_KEYS = {
  LLM_PROFILES: "llm.profiles",
  MAIL_ACCOUNTS: "mail.accounts",
  TOOL_CONFIGS: "tools.configs",
  AGENT_SPECS: "agents.specs",
  EMBEDDING: "knowledge.embedding",  // 阶段 7.7 新增
} as const;

export type SystemSettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** 读结果 —— 始终携带 updated_at 用于乐观并发回带 */
export interface SystemSettingRead<T> {
  readonly value: T;
  readonly updatedAt: string;  // ISO-8601
}

/**
 * ISystemSettingRepository —— 单表 + 5 个 typed convenience。
 *
 * 写方法（setLLMProfiles 等）：
 *   - expectedUpdatedAt?: 传则乐观并发；0 rows affected → CONFLICT
 *   - 不传 → last-write-wins
 */
export interface ISystemSettingRepository {
  // ---- 读：typed convenience ----
  getLLMProfiles(): Promise<SystemSettingRead<LLMProfilesSettingData> | null>;
  getMailAccounts(): Promise<SystemSettingRead<MailAccountsSettingData> | null>;
  getToolConfigs(): Promise<SystemSettingRead<ToolConfigsSettingData> | null>;
  getAgentSpecs(): Promise<SystemSettingRead<SubAgentSpecsSettingData> | null>;
  getEmbeddingConfig(): Promise<SystemSettingRead<EmbeddingConfigSettingData> | null>;

  // ---- 写：typed convenience ----
  setLLMProfiles(value: LLMProfilesSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<LLMProfilesSettingData>>>;
  setMailAccounts(value: MailAccountsSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<MailAccountsSettingData>>>;
  setToolConfigs(value: ToolConfigsSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<ToolConfigsSettingData>>>;
  setAgentSpecs(value: SubAgentSpecsSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<SubAgentSpecsSettingData>>>;
  setEmbeddingConfig(value: EmbeddingConfigSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<EmbeddingConfigSettingData>>>;

  // ---- 逃生口（仅测试 / seed） ----
  getRaw<T>(key: SystemSettingKey): Promise<SystemSettingRead<T> | null>;
  setRaw<T>(key: SystemSettingKey, value: T, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<T>>>;
}