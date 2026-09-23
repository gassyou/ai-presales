/**
 * ToolConfigsSetting —— 阶段 7.4h
 *
 * 5 个 builtin tool 的运行时配置集合；纯函数 + 校验。
 *
 * 校验：
 *   - 每个 key 必须存在于 ToolRegistry（运行时由 settings.usecase 注入当前 names 列表）
 *   - 每个 value 是 object（不允许 primitive）
 *
 * 注：每个 tool 的具体字段 schema 由工具本身的 `configure(opts)` 决定；这里只校验
 * 顶层形状（map），细字段交给 tool 自己 reject 不识别的字段。
 */

import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";

export type ToolConfigMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface ToolConfigsSettingData {
  readonly configs: ToolConfigMap;
}

export class ToolConfigsSetting {
  private constructor(private readonly data: ToolConfigsSettingData) {}

  /**
   * 创建聚合。
   * @param knownToolNames 已知工具名列表（来自 ToolRegistry.names()）；空集合视为不校验
   */
  static create(
    input: ToolConfigsSettingData,
    knownToolNames: readonly string[],
  ): DomainResult<ToolConfigsSetting> {
    if (!input || !input.configs || typeof input.configs !== "object") {
      return domainErr("INVALID_INPUT", "configs must be an object");
    }
    for (const [k, v] of Object.entries(input.configs)) {
      if (typeof k !== "string" || k.length === 0) {
        return domainErr("INVALID_INPUT", "config key must be non-empty string");
      }
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return domainErr("INVALID_INPUT", `config for "${k}" must be object`);
      }
      if (knownToolNames.length > 0 && !knownToolNames.includes(k)) {
        return domainErr("INVALID_INPUT", `unknown tool: ${k}`, { known: knownToolNames });
      }
    }
    return domainOk(new ToolConfigsSetting({
      configs: Object.freeze(Object.fromEntries(
        Object.entries(input.configs).map(([k, v]) => [k, Object.freeze({ ...v })]),
      )) as ToolConfigMap,
    }));
  }

  get configs(): ToolConfigMap {
    return this.data.configs;
  }

  toJSON(): ToolConfigsSettingData {
    return {
      configs: Object.fromEntries(
        Object.entries(this.data.configs).map(([k, v]) => [k, { ...v }]),
      ),
    };
  }
}