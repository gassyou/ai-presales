/**
 * SettingsUseCase —— 阶段 7.4h
 *
 * 4 类系统设置（LLM profiles / mail accounts / tool configs / sub-agent specs）的 CRUD。
 *
 * 责任：
 *   - 调领域层 aggregate.create(value) 校验（领域层兜底）
 *   - 调仓储写库（含乐观并发）
 *   - 写完后触发 hot-reload callback（main.ts 注入）
 *
 * 不负责：构造 LLM client / SMTP transport —— 那些是 runtime 调用方的事。
 */

import type { Clock } from "@backend/domain/shared/clock.ts";
import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import type { ISystemSettingRepository, SystemSettingRead } from "@backend/domain/settings/system-setting.repository.ts";
import { LLMProfilesSetting, type LLMProfilesSettingData } from "@backend/domain/settings/llm-profiles.setting.ts";
import { MailAccountsSetting, type MailAccountsSettingData } from "@backend/domain/settings/mail-accounts.setting.ts";
import { ToolConfigsSetting, type ToolConfigsSettingData } from "@backend/domain/settings/tool-configs.setting.ts";
import { SubAgentSpecsSetting, type SubAgentSpecsSettingData } from "@backend/domain/settings/sub-agent-specs.setting.ts";
import type { SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { EmbeddingConfigSetting, type EmbeddingConfigSettingData } from "@backend/domain/settings/embedding-config.setting.ts";
import type { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { SqliteBackedSubAgentRegistry } from "@backend/persistence/sqlite/sqlite-sub-agent-registry.ts";
import type { ConfigurableToolRegistry } from "./configurable-tool-registry.ts";
import type { LLMClientResolver } from "./llm-client-resolver.ts";
import type { EmbeddingProviderResolver } from "./embedding-resolver.ts";
import type { ContextAssembler } from "@backend/ai/context/context-assembler.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export interface SettingsUseCaseDeps {
  readonly settings: ISystemSettingRepository;
  readonly clock: Clock;
  readonly toolRegistry: ToolRegistry;  // 用于 settings 校验（key ⊆ names）
  readonly configurableTools: ConfigurableToolRegistry;
  readonly subAgentRegistry: SqliteBackedSubAgentRegistry;
  readonly llmClientResolver: LLMClientResolver;
  readonly embeddingProviderResolver?: EmbeddingProviderResolver;  // 阶段 7.7
  readonly contextAssembler?: ContextAssembler;
  readonly logger: Logger;
}

/** settings 行快照 —— settings 表单显示用 */
export type SystemSettingsSnapshot = {
  llmProfiles: SystemSettingRead<LLMProfilesSettingData> | null;
  mailAccounts: SystemSettingRead<MailAccountsSettingData> | null;
  toolConfigs: SystemSettingRead<ToolConfigsSettingData> | null;
  agentSpecs: SystemSettingRead<SubAgentSpecsSettingData> | null;
  embedding: SystemSettingRead<EmbeddingConfigSettingData> | null;
};

export class SettingsUseCase {
  /** 阶段 7.4h：最近一次读到的 LLM profiles 快照（用于 sync 的 profileSnapshot lambda） */
  private llmProfilesCache: SystemSettingRead<LLMProfilesSettingData> | null = null;

  constructor(private readonly deps: SettingsUseCaseDeps) {}

  // ---- Getters ----

  async getLLMProfiles(): Promise<SystemSettingRead<LLMProfilesSettingData> | null> {
    const v = await this.deps.settings.getLLMProfiles();
    this.llmProfilesCache = v;
    return v;
  }
  async getMailAccounts(): Promise<SystemSettingRead<MailAccountsSettingData> | null> {
    return await this.deps.settings.getMailAccounts();
  }
  async getToolConfigs(): Promise<SystemSettingRead<ToolConfigsSettingData> | null> {
    return await this.deps.settings.getToolConfigs();
  }
  async getAgentSpecs(): Promise<SystemSettingRead<SubAgentSpecsSettingData> | null> {
    return await this.deps.settings.getAgentSpecs();
  }
  async getEmbeddingConfig(): Promise<SystemSettingRead<EmbeddingConfigSettingData> | null> {
    return await this.deps.settings.getEmbeddingConfig();
  }

  async snapshotAll(): Promise<SystemSettingsSnapshot> {
    const [llm, mail, tools, agents, embedding] = await Promise.all([
      this.deps.settings.getLLMProfiles(),
      this.deps.settings.getMailAccounts(),
      this.deps.settings.getToolConfigs(),
      this.deps.settings.getAgentSpecs(),
      this.deps.settings.getEmbeddingConfig(),
    ]);
    return {
      llmProfiles: llm,
      mailAccounts: mail,
      toolConfigs: tools,
      agentSpecs: agents,
      embedding,
    };
  }

  // ---- Updaters ----

  async updateLLMProfiles(
    value: LLMProfilesSettingData,
    expectedUpdatedAt?: string,
  ): Promise<DomainResult<SystemSettingRead<LLMProfilesSettingData>>> {
    const v = LLMProfilesSetting.create(value);
    if (!v.ok) return v;
    const out = await this.deps.settings.setLLMProfiles(v.value.toJSON(), this.deps.clock, expectedUpdatedAt);
    if (!out.ok) return out;
    this.llmProfilesCache = out.value;
    await this.afterLLMProfilesChanged(out.value.value);
    return out;
  }

  async updateMailAccounts(
    value: MailAccountsSettingData,
    expectedUpdatedAt?: string,
  ): Promise<DomainResult<SystemSettingRead<MailAccountsSettingData>>> {
    const v = MailAccountsSetting.create(value);
    if (!v.ok) return v;
    const out = await this.deps.settings.setMailAccounts(v.value.toJSON(), this.deps.clock, expectedUpdatedAt);
    return out;
  }

  async updateToolConfigs(
    value: ToolConfigsSettingData,
    expectedUpdatedAt?: string,
  ): Promise<DomainResult<SystemSettingRead<ToolConfigsSettingData>>> {
    const known = this.deps.toolRegistry.names();
    const v = ToolConfigsSetting.create(value, known);
    if (!v.ok) return v;
    const out = await this.deps.settings.setToolConfigs(v.value.toJSON(), this.deps.clock, expectedUpdatedAt);
    if (!out.ok) return out;
    await this.afterToolConfigsChanged();
    return out;
  }

  async updateAgentSpecs(
    value: SubAgentSpecsSettingData,
    expectedUpdatedAt?: string,
  ): Promise<DomainResult<SystemSettingRead<SubAgentSpecsSettingData>>> {
    const known = this.deps.toolRegistry.names();
    const v = SubAgentSpecsSetting.create(value, known);
    if (!v.ok) return v;
    const out = await this.deps.settings.setAgentSpecs(v.value.toJSON(), this.deps.clock, expectedUpdatedAt);
    if (!out.ok) return out;
    await this.afterAgentSpecsChanged();
    return out;
  }

  // ===== 阶段 4：sub-agent 单条 CRUD（system 拒绝用户操作） =====

  /**
   * 新增一个 user 类型 sub-agent spec。
   * - name 全局唯一（与 builtin 不冲突）
   * - 缺省 type = "user"
   * - 写入前自动合并现有 spec
   */
  async createAgentSpec(
    spec: SubAgentSpecData,
  ): Promise<DomainResult<SystemSettingRead<SubAgentSpecsSettingData>>> {
    const cur = await this.deps.settings.getAgentSpecs();
    const curSpecs = cur?.value.specs ?? {};
    const merged = { ...curSpecs, [spec.name]: { ...spec, type: spec.type ?? "user" } };
    return await this.updateAgentSpecs({ specs: merged }, cur?.updatedAt);
  }

  /**
   * 更新单个 spec（按 name）。不允许把 system spec 改成 user spec 或 vice-versa
   * （type 锁定）。
   */
  async updateAgentSpec(
    name: string,
    patch: Partial<Omit<SubAgentSpecData, "name" | "type">>,
  ): Promise<DomainResult<SystemSettingRead<SubAgentSpecsSettingData>>> {
    const cur = await this.deps.settings.getAgentSpecs();
    const curSpecs = cur?.value.specs ?? {};
    const existing = curSpecs[name];
    if (!existing) {
      return domainErr("NOT_FOUND", `sub-agent spec not found: ${name}`);
    }
    // 阶段 4：system spec 不能改名为 user 或被用户篡改 type
    const merged = {
      ...curSpecs,
      [name]: { ...existing, ...patch, type: existing.type ?? "user" },
    };
    return await this.updateAgentSpecs({ specs: merged }, cur?.updatedAt);
  }

  /**
   * 删除单个 spec。阶段 4：type=system 拒绝删除（INTERNAL 错误）。
   */
  async deleteAgentSpec(
    name: string,
  ): Promise<DomainResult<SystemSettingRead<SubAgentSpecsSettingData>>> {
    const cur = await this.deps.settings.getAgentSpecs();
    const curSpecs = cur?.value.specs ?? {};
    const existing = curSpecs[name];
    if (!existing) {
      return domainErr("NOT_FOUND", `sub-agent spec not found: ${name}`);
    }
    if ((existing.type ?? "user") === "system") {
      return domainErr(
        "INTERNAL",
        `system sub-agent cannot be deleted: ${name}`,
      );
    }
    const { [name]: _, ...rest } = curSpecs;
    return await this.updateAgentSpecs({ specs: rest }, cur?.updatedAt);
  }

  /**
   * 阶段 4：seed builtin sub-agent specs（启动时调用）。如果 spec 已存在但 type
   * 缺失或为 user，会把 type 修正为 system（保持运行时的状态）。
   */
  async seedBuiltinAgentSpecsIfMissing(): Promise<void> {
    // 复用 builtin 列表（已含 type=system）
    const { getBuiltinSubAgentSpecs } = await import("../sub-agent/builtin-sub-agents.ts");
    const builtins = getBuiltinSubAgentSpecs();
    const cur = await this.deps.settings.getAgentSpecs();
    const curSpecs = cur?.value.specs ?? {};
    let dirty = false;
    const next: Record<string, SubAgentSpecData> = { ...curSpecs };
    for (const b of builtins) {
      const exist = curSpecs[b.name];
      if (!exist) {
        next[b.name] = b;
        dirty = true;
        continue;
      }
      // 已存在但缺 type → 修正
      if ((exist.type ?? "user") !== "system") {
        next[b.name] = { ...exist, type: "system" };
        dirty = true;
      }
    }
    if (dirty) {
      await this.updateAgentSpecs({ specs: next }, cur?.updatedAt);
    }
  }

  // 阶段 7.7：embedding provider 配置
  async updateEmbeddingConfig(
    value: EmbeddingConfigSettingData,
    expectedUpdatedAt?: string,
  ): Promise<DomainResult<SystemSettingRead<EmbeddingConfigSettingData>>> {
    const v = EmbeddingConfigSetting.create(value);
    if (!v.ok) return v;
    const out = await this.deps.settings.setEmbeddingConfig(v.value.toJSON(), this.deps.clock, expectedUpdatedAt);
    if (!out.ok) return out;
    await this.afterEmbeddingConfigChanged();
    return out;
  }

  // ---- Hot-reload hooks ----

  private async afterLLMProfilesChanged(value: LLMProfilesSettingData): Promise<void> {
    this.deps.llmClientResolver.invalidate();
    this.deps.logger.info("LLM profiles updated; client cache invalidated", { count: value.profiles.length, defaultProfile: value.defaultProfile });

    // ContextAssembler hot-reload：基于新 defaultProfile 更新 budget
    if (this.deps.contextAssembler) {
      const def = value.profiles.find((p) => p.name === value.defaultProfile);
      if (def) {
        this.deps.contextAssembler.setConfig({
          contextWindow: Math.max(200_000, def.maxTokens * 10),
          maxOutputTokens: def.maxTokens,
        });
        this.deps.logger.info("ContextAssembler config refreshed", {
          defaultProfile: value.defaultProfile,
          contextWindow: Math.max(200_000, def.maxTokens * 10),
          maxOutputTokens: def.maxTokens,
        });
      }
    }
  }

  private async afterToolConfigsChanged(): Promise<void> {
    await this.deps.configurableTools.refreshAllAsync();
    this.deps.logger.info("Tool configs applied");
  }

  private async afterAgentSpecsChanged(): Promise<void> {
    await this.deps.subAgentRegistry.refreshSyncCacheAsync();
    this.deps.logger.info("Sub-agent specs cache refreshed");
  }

  private async afterEmbeddingConfigChanged(): Promise<void> {
    if (this.deps.embeddingProviderResolver) {
      this.deps.embeddingProviderResolver.invalidate();
      this.deps.logger.info("Embedding config updated; provider cache invalidated");
    } else {
      this.deps.logger.warn("Embedding config updated but no embeddingProviderResolver wired; restart required for changes to take effect");
    }
  }

  // ---- Sync accessor for hot-path callers (sub-agent runner) ----

  /**
   * 返回最近一次 get/update LLMProfiles 后的内存快照（同步）。
   * - 第一次访问前：会 lazy 异步触发一次 DB 读取；之后被 cache 命中
   * - 主要用于 sub-agent invoke 时 sync 拿 current default profile 的 temperature/maxTokens
   * - 不会有 stale 问题：settings 改完一定会经过 get/setLLMProfiles → cache 立即刷新
   */
  cachedLLMProfiles(): SystemSettingRead<LLMProfilesSettingData> | null {
    if (!this.llmProfilesCache) {
      // kick off async refresh；调用方拿到 null 但下轮会拿到新值
      void this.getLLMProfiles();
    }
    return this.llmProfilesCache;
  }
}