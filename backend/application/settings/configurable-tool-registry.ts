/**
 * ConfigurableToolRegistry —— 阶段 7.4h
 *
 * 包一层 ToolRegistry + ISystemSettingRepository：
 *   - 每次 get(name) 时检查该 tool 的 `tools.configs` 行 updated_at 是否变化；
 *     变化则调 tool.configure?(opts) 并更新 lastApplied[name]
 *   - list/names 走底层 registry（这些通常一次拿全）
 *
 * sync/async 桥接：
 *   - ISystemSettingRepository.getToolConfigs() 是 async，无法在 sync get() 内 await
 *   - 这里用模块级 snapshot cache + refreshAllAsync() 显式刷新
 *   - 启动期 main.ts 调用一次；settings.usecase.updateToolConfigs 成功后调一次
 *
 * 设计：
 *   - Tool 没实现 configure → 静默跳过（`configure?` optional）
 *   - configure 抛错 → 静默跳过（不阻塞工具使用）
 */

import type { Tool } from "@backend/ai/tool/tool.ts";
import type { IToolRegistry, ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { ISystemSettingRepository } from "@backend/domain/settings/system-setting.repository.ts";

// 模块级 snapshot cache —— 同步可见，refreshAllAsync 写入，sync get 内读
const snapshotByUpdatedAt = new Map<string, { configs: Record<string, Record<string, unknown>> }>();
let latestUpdatedAt: string | null = null;

export class ConfigurableToolRegistry implements IToolRegistry {
  private lastApplied = new Map<string, string>();

  constructor(
    private readonly inner: ToolRegistry,
    private readonly settings: ISystemSettingRepository,
  ) {}

  register(tool: Tool): void {
    this.inner.register(tool);
  }

  get(name: string): Tool | undefined {
    const tool = this.inner.get(name);
    if (!tool) return undefined;
    this.maybeApplyConfig(name, tool);
    return tool;
  }

  has(name: string): boolean {
    return this.inner.has(name);
  }

  list(): readonly Tool[] {
    return this.inner.list();
  }

  names(): readonly string[] {
    return this.inner.names();
  }

  clear(): void {
    this.inner.clear();
  }

  toLLMTools(): Array<{
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
  }> {
    return this.inner.toLLMTools();
  }

  /**
   * 显式强制重读最新 config —— settings.usecase 写完后调（fire-and-forget）。
   */
  async refreshAllAsync(): Promise<void> {
    const row = await this.settings.getToolConfigs();
    if (!row) {
      latestUpdatedAt = null;
      return;
    }
    latestUpdatedAt = row.updatedAt;
    snapshotByUpdatedAt.set(row.updatedAt, { configs: row.value.configs as Record<string, Record<string, unknown>> });
    for (const tool of this.inner.list()) {
      const cfg = row.value.configs[tool.name];
      this.applyConfigFor(tool, cfg, row.updatedAt);
    }
  }

  private maybeApplyConfig(name: string, tool: Tool): void {
    if (!latestUpdatedAt) return;
    const lastApplied = this.lastApplied.get(name);
    if (lastApplied === latestUpdatedAt) return;
    const snapshot = snapshotByUpdatedAt.get(latestUpdatedAt);
    if (!snapshot) return;
    const cfg = snapshot.configs[name];
    this.applyConfigFor(tool, cfg, latestUpdatedAt);
  }

  private applyConfigFor(tool: Tool, cfg: unknown, updatedAt: string): void {
    if (typeof tool.configure === "function" && cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      try {
        tool.configure(cfg as Record<string, unknown>);
      } catch {
        // swallow — configure 失败不阻塞工具使用
      }
    }
    this.lastApplied.set(tool.name, updatedAt);
  }

  /** 仅测试用 —— 清空 snapshot 与 lastApplied */
  static clearSnapshotForTests(): void {
    snapshotByUpdatedAt.clear();
    latestUpdatedAt = null;
  }
}