/**
 * SubAgentSpecsSetting —— 阶段 7.4h
 *
 * 5 个 builtin sub-agent 的 spec 集合的领域 VO；纯函数 + 校验。
 *
 * 校验：
 *   - 每个 spec 委托给 SubAgentSpecVO.create()（name pattern / 长度等）
 *   - spec.toolNames ⊆ knownToolNames（运行时由 settings.usecase 注入）
 */

import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import { SubAgentSpecVO, type SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";

export interface SubAgentSpecsSettingData {
  /** key=spec.name；同 name 重复 → INVALID_INPUT */
  readonly specs: Readonly<Record<string, SubAgentSpecData>>;
}

export class SubAgentSpecsSetting {
  private constructor(private readonly data: SubAgentSpecsSettingData) {}

  /**
   * 创建聚合。
   * @param knownToolNames 已知工具名列表（来自 ToolRegistry.names()）
   */
  static create(
    input: SubAgentSpecsSettingData,
    knownToolNames: readonly string[],
  ): DomainResult<SubAgentSpecsSetting> {
    if (!input || !input.specs || typeof input.specs !== "object") {
      return domainErr("INVALID_INPUT", "specs must be an object");
    }
    const seen = new Set<string>();
    const validated: SubAgentSpecData[] = [];
    for (const [key, raw] of Object.entries(input.specs)) {
      if (!raw || typeof raw !== "object") {
        return domainErr("INVALID_INPUT", `spec "${key}": must be object`);
      }
      if (raw.name !== key) {
        return domainErr("INVALID_INPUT", `spec key mismatch: key="${key}" but spec.name="${raw.name}"`);
      }
      if (seen.has(key)) {
        return domainErr("INVALID_INPUT", `duplicate spec name: ${key}`);
      }
      seen.add(key);
      // 校验 name / 长度 / toolNames 形状
      const r = SubAgentSpecVO.create(raw);
      if (!r.ok) {
        return domainErr("INVALID_INPUT", `spec "${key}": ${r.error.message}`, r.error.details);
      }
      // toolNames ⊆ knownToolNames
      if (knownToolNames.length > 0) {
        for (const tn of raw.toolNames) {
          if (!knownToolNames.includes(tn)) {
            return domainErr("INVALID_INPUT", `spec "${key}": unknown tool "${tn}"`, { known: knownToolNames });
          }
        }
      }
      validated.push(raw);
    }
    return domainOk(new SubAgentSpecsSetting({
      specs: Object.freeze(Object.fromEntries(
        validated.map((s) => [s.name, Object.freeze({ ...s, toolNames: Object.freeze([...s.toolNames]) })]),
      )) as Readonly<Record<string, SubAgentSpecData>>,
    }));
  }

  get specs(): Readonly<Record<string, SubAgentSpecData>> {
    return this.data.specs;
  }

  toJSON(): SubAgentSpecsSettingData {
    const out: Record<string, SubAgentSpecData> = {};
    for (const [k, v] of Object.entries(this.data.specs)) {
      out[k] = {
        name: v.name,
        displayName: v.displayName,
        description: v.description,
        systemPrompt: v.systemPrompt,
        toolNames: [...v.toolNames],
        ...(v.profileHint !== undefined ? { profileHint: v.profileHint } : {}),
        ...(v.outputSchema !== undefined ? { outputSchema: v.outputSchema } : {}),
      };
    }
    return { specs: out };
  }

  /** 给 SqliteBackedSubAgentRegistry 用 —— 拿到所有 spec VO（每次新建，因 SubAgentSpecVO 是 frozen） */
  listAsVOs(): readonly SubAgentSpecVO[] {
    const out: SubAgentSpecVO[] = [];
    for (const raw of Object.values(this.data.specs)) {
      const r = SubAgentSpecVO.create(raw);
      if (r.ok) out.push(r.value);
    }
    return out;
  }
}