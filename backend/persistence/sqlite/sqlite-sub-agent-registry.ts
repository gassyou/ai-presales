/**
 * SqliteBackedSubAgentRegistry —— 阶段 7.4h
 *
 * 实现了现有 ISubAgentRegistry 接口（sync get/list/names/has）；spec 从
 * system_settings.agents.specs 读取。
 *
 * sync/async 桥接：
 *   - ISubAgentRegistry.get 是 sync，无法直接 await async settings 读
 *   - 这里用 sync 模块级 cache；启动期 + 每次 settings update 后由 main.ts / settings.usecase
 *     显式调 refreshSyncCacheAsync() 刷新
 *   - 调用链保证：refreshSyncCacheAsync 是 fire-and-forget；下一次 sync get 看到的
 *     是上一次成功的 cache 状态（DB 已 commit，写时序不丢）
 *
 * 设计要点：
 *   - 不实现 register() —— spec 由 settings 写入；这是只读视图
 *   - 现有 InvokeSubAgentUseCase + sub-agent.route.ts 都在每次 invoke 时调 registry.get(name)，
 *     自动用最新 spec
 */

import type { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import { type DomainResult, domainErr } from "@backend/domain/shared/result.ts";
import type { ISystemSettingRepository } from "@backend/domain/settings/system-setting.repository.ts";
import { SubAgentSpecsSetting } from "@backend/domain/settings/sub-agent-specs.setting.ts";

/** 模块级 sync cache —— 进程内同步可见 */
const syncCache = new Map<string, SubAgentSpecVO>();

export class SqliteBackedSubAgentRegistry implements ISubAgentRegistry {
  constructor(private readonly settings: ISystemSettingRepository) {}

  register(_spec: SubAgentSpecVO): DomainResult<SubAgentSpecVO> {
    return domainErr("INTERNAL", "SqliteBackedSubAgentRegistry is read-only; spec comes from system_settings");
  }

  get(name: string): SubAgentSpecVO | undefined {
    return syncCache.get(name);
  }

  list(): readonly SubAgentSpecVO[] {
    return Array.from(syncCache.values());
  }

  names(): readonly string[] {
    return Array.from(syncCache.keys());
  }

  has(name: string): boolean {
    return syncCache.has(name);
  }

  /**
   * 异步刷新 sync cache —— 从 settings 读最新值。
   *
   * 启动期 main.ts 调用一次（seed 后）。
   * settings.usecase.updateAgentSpecs 成功后调用一次（fire-and-forget）。
   */
  async refreshSyncCacheAsync(): Promise<void> {
    syncCache.clear();
    const row = await this.settings.getAgentSpecs();
    if (!row) return;
    // 启动期不校验 toolNames（listAsVOs 内部已 SubAgentSpecVO.create，会校验基本字段）
    const setting = SubAgentSpecsSetting.create(row.value, []);
    if (!setting.ok) return;
    for (const specVO of setting.value.listAsVOs()) {
      syncCache.set(specVO.name, specVO);
    }
  }

  /** 仅测试用 —— 清空 cache */
  static clearCacheForTests(): void {
    syncCache.clear();
  }
}