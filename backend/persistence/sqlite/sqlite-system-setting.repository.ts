/**
 * SqliteSystemSettingRepository —— 阶段 7.4h
 *
 * 单表读写 system_settings；带 5 秒 TTL 内存缓存避免热路径（如 resolveClient）round-trip DB。
 * 写时立即失效缓存。乐观并发：传 expectedUpdatedAt 时 SQL 带 WHERE updated_at = ?；
 * 0 rows affected → DomainError{CONFLICT}。
 */

import type { Database } from "@backend/persistence/database/database.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";
import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import {
  type ISystemSettingRepository,
  SETTING_KEYS,
  type SystemSettingKey,
  type SystemSettingRead,
} from "@backend/domain/settings/system-setting.repository.ts";
import { LLMProfilesSetting, type LLMProfilesSettingData } from "@backend/domain/settings/llm-profiles.setting.ts";
import { MailAccountsSetting, type MailAccountsSettingData } from "@backend/domain/settings/mail-accounts.setting.ts";
import { ToolConfigsSetting, type ToolConfigsSettingData } from "@backend/domain/settings/tool-configs.setting.ts";
import { SubAgentSpecsSetting, type SubAgentSpecsSettingData } from "@backend/domain/settings/sub-agent-specs.setting.ts";
import { type EmbeddingConfigSettingData } from "@backend/domain/settings/embedding-config.setting.ts";

const CACHE_TTL_MS = 5_000;

interface CacheEntry<T> {
  value: T;
  updatedAt: string;
  cachedAt: number;
}

export class SqliteSystemSettingRepository implements ISystemSettingRepository {
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly db: Database) {}

  // ---- typed convenience getters ----

  async getLLMProfiles(): Promise<SystemSettingRead<LLMProfilesSettingData> | null> {
    return this.getTyped<LLMProfilesSettingData>(SETTING_KEYS.LLM_PROFILES);
  }
  async getMailAccounts(): Promise<SystemSettingRead<MailAccountsSettingData> | null> {
    return this.getTyped<MailAccountsSettingData>(SETTING_KEYS.MAIL_ACCOUNTS);
  }
  async getToolConfigs(): Promise<SystemSettingRead<ToolConfigsSettingData> | null> {
    return this.getTyped<ToolConfigsSettingData>(SETTING_KEYS.TOOL_CONFIGS);
  }
  async getAgentSpecs(): Promise<SystemSettingRead<SubAgentSpecsSettingData> | null> {
    return this.getTyped<SubAgentSpecsSettingData>(SETTING_KEYS.AGENT_SPECS);
  }
  async getEmbeddingConfig(): Promise<SystemSettingRead<EmbeddingConfigSettingData> | null> {
    return this.getTyped<EmbeddingConfigSettingData>(SETTING_KEYS.EMBEDDING);
  }

  // ---- typed convenience setters ----

  async setLLMProfiles(value: LLMProfilesSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<LLMProfilesSettingData>>> {
    return this.setTyped(SETTING_KEYS.LLM_PROFILES, value, clock, expectedUpdatedAt);
  }
  async setMailAccounts(value: MailAccountsSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<MailAccountsSettingData>>> {
    return this.setTyped(SETTING_KEYS.MAIL_ACCOUNTS, value, clock, expectedUpdatedAt);
  }
  async setToolConfigs(value: ToolConfigsSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<ToolConfigsSettingData>>> {
    return this.setTyped(SETTING_KEYS.TOOL_CONFIGS, value, clock, expectedUpdatedAt);
  }
  async setAgentSpecs(value: SubAgentSpecsSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<SubAgentSpecsSettingData>>> {
    return this.setTyped(SETTING_KEYS.AGENT_SPECS, value, clock, expectedUpdatedAt);
  }
  async setEmbeddingConfig(value: EmbeddingConfigSettingData, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<EmbeddingConfigSettingData>>> {
    return this.setTyped(SETTING_KEYS.EMBEDDING, value, clock, expectedUpdatedAt);
  }

  // ---- raw escape hatch (test / seed) ----

  async getRaw<T>(key: SystemSettingKey): Promise<SystemSettingRead<T> | null> {
    return this.getTyped<T>(key);
  }

  async setRaw<T>(key: SystemSettingKey, value: T, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<T>>> {
    return this.setTyped<T>(key, value, clock, expectedUpdatedAt);
  }

  // ---- internals ----

  private async getTyped<T>(key: SystemSettingKey): Promise<SystemSettingRead<T> | null> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
      return { value: cached.value as T, updatedAt: cached.updatedAt };
    }
    const row = this.db.queryRow<{ value_json: string; updated_at: string }>(
      "SELECT value_json, updated_at FROM system_settings WHERE key=?",
      [key],
    );
    if (!row) return null;
    let parsed: T;
    try {
      parsed = JSON.parse(row.value_json) as T;
    } catch (e) {
      throw new Error(`failed to parse system_settings[${key}]: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.cache.set(key, { value: parsed, updatedAt: row.updated_at, cachedAt: now });
    return { value: parsed, updatedAt: row.updated_at };
  }

  private async setTyped<T>(key: SystemSettingKey, value: T, clock: Clock, expectedUpdatedAt?: string): Promise<DomainResult<SystemSettingRead<T>>> {
    const newUpdatedAt = clock.now().toISOString();
    const json = JSON.stringify(value);
    let result: { changes: number };

    if (expectedUpdatedAt !== undefined) {
      // 乐观并发：仅当行存在且 updated_at 匹配才更新
      result = this.db.run(
        "UPDATE system_settings SET value_json=?, updated_at=? WHERE key=? AND updated_at=?",
        [json, newUpdatedAt, key, expectedUpdatedAt],
      );
      if (result.changes === 0) {
        return domainErr("CONFLICT", `system_settings[${key}] was modified by another writer`, { key, expectedUpdatedAt });
      }
    } else {
      // last-write-wins：INSERT OR REPLACE（首次插入或覆盖）
      result = this.db.run(
        "INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
        [key, json, newUpdatedAt],
      );
    }

    // 写后失效缓存
    this.cache.delete(key);
    return domainOk({ value, updatedAt: newUpdatedAt });
  }

  /** seed helper —— 启动期 idempotent：仅当 key 不存在时写 */
  async seedIfEmpty(key: SystemSettingKey, value: unknown, clock: Clock): Promise<void> {
    const existing = await this.getTyped(key);
    if (existing) return;
    const newUpdatedAt = clock.now().toISOString();
    this.db.run(
      "INSERT OR IGNORE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
      [key, JSON.stringify(value), newUpdatedAt],
    );
  }
}

// 提供工厂用的类型导出（供 main.ts 装配）
export type { LLMProfileConfig } from "@backend/domain/settings/llm-profiles.setting.ts";
export { LLMProfilesSetting, MailAccountsSetting, ToolConfigsSetting, SubAgentSpecsSetting };
