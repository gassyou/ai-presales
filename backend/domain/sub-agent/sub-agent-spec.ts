/**
 * SubAgentSpec —— sub-agent 的领域值对象
 *
 * 设计原则：
 *   - 不可变 record（freeze）
 *   - 工具名列表只引用 ToolRegistry 中已注册的 name（运行时校验，不在此校验）
 *   - profileHint 用于在不同 profile 间路由（"fast" / "deep" / "local"）
 *   - outputSchema（可选 JSON Schema）让 runner 可以要求结构化输出
 *
 * 命名约束：name 是注册到 ISubAgentRegistry 的主键；只能包含字母 / 数字 / 下划线 / 连字符
 */

import { type DomainResult, domainOk, domainErr } from "../shared/result.ts";

export type SubAgentName = string; // 主键类型；实际使用 brand 更安全，本期先 string

export interface SubAgentSpecData {
  readonly name: SubAgentName;
  readonly displayName: string;
  readonly description: string;
  readonly systemPrompt: string;
  /** 引用的工具名列表；运行时由 ToolRegistry 解析 */
  readonly toolNames: readonly string[];
  /** 路由该 sub-agent 用哪个 LLM profile；缺省走 AppConfig.defaultProfile */
  readonly profileHint?: string;
  /** 输出 JSON Schema（可选） */
  readonly outputSchema?: Record<string, unknown>;
}

const NAME_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;

export class SubAgentSpecVO {
  private constructor(private readonly data: SubAgentSpecData) {
    Object.freeze(this.data);
    Object.freeze(this);
  }

  static create(input: SubAgentSpecData): DomainResult<SubAgentSpecVO> {
    if (!input.name || !NAME_PATTERN.test(input.name)) {
      return domainErr("INVALID_INPUT", `invalid sub-agent name: ${input.name}`, {
        pattern: NAME_PATTERN.source,
      });
    }
    if (!input.displayName || input.displayName.trim().length === 0) {
      return domainErr("INVALID_INPUT", "displayName is required");
    }
    if (input.displayName.length > 120) {
      return domainErr("INVALID_INPUT", "displayName too long (>120 chars)");
    }
    if (!input.systemPrompt || input.systemPrompt.trim().length === 0) {
      return domainErr("INVALID_INPUT", "systemPrompt is required");
    }
    if (input.systemPrompt.length > 16_000) {
      return domainErr("INVALID_INPUT", "systemPrompt too long (>16000 chars)");
    }
    if (!Array.isArray(input.toolNames)) {
      return domainErr("INVALID_INPUT", "toolNames must be an array");
    }
    for (const tn of input.toolNames) {
      if (typeof tn !== "string" || tn.length === 0) {
        return domainErr("INVALID_INPUT", "toolNames contains non-string or empty entry");
      }
    }

    return domainOk(new SubAgentSpecVO({
      name: input.name,
      displayName: input.displayName.trim(),
      description: input.description?.trim() ?? "",
      systemPrompt: input.systemPrompt.trim(),
      toolNames: Object.freeze([...input.toolNames]),
      ...(input.profileHint !== undefined ? { profileHint: input.profileHint } : {}),
      ...(input.outputSchema !== undefined ? { outputSchema: input.outputSchema } : {}),
    }));
  }

  get name(): SubAgentName {
    return this.data.name;
  }
  get displayName(): string {
    return this.data.displayName;
  }
  get description(): string {
    return this.data.description;
  }
  get systemPrompt(): string {
    return this.data.systemPrompt;
  }
  get toolNames(): readonly string[] {
    return this.data.toolNames;
  }
  get profileHint(): string | undefined {
    return this.data.profileHint;
  }
  get outputSchema(): Record<string, unknown> | undefined {
    return this.data.outputSchema;
  }

  /** DTO —— 用于 API 响应 / 前端 */
  toDTO(): SubAgentSpecData {
    return {
      name: this.data.name,
      displayName: this.data.displayName,
      description: this.data.description,
      systemPrompt: this.data.systemPrompt,
      toolNames: this.data.toolNames,
      ...(this.data.profileHint !== undefined ? { profileHint: this.data.profileHint } : {}),
      ...(this.data.outputSchema !== undefined ? { outputSchema: this.data.outputSchema } : {}),
    };
  }
}