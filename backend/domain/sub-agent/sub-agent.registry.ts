/**
 * SubAgentRegistry —— 进程内 sub-agent 注册表
 *
 * 不持久化（spec 是配置而非业务对象）；启动期从 config 装载。
 */

import { SubAgentSpecVO } from "./sub-agent-spec.ts";
import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";

export interface ISubAgentRegistry {
  register(spec: SubAgentSpecVO): DomainResult<SubAgentSpecVO>;
  get(name: string): SubAgentSpecVO | undefined;
  list(): readonly SubAgentSpecVO[];
  names(): readonly string[];
  has(name: string): boolean;
}

export class InMemorySubAgentRegistry implements ISubAgentRegistry {
  private readonly _specs = new Map<string, SubAgentSpecVO>();

  register(spec: SubAgentSpecVO): DomainResult<SubAgentSpecVO> {
    if (this._specs.has(spec.name)) {
      return domainErr("CONFLICT", `sub-agent already registered: ${spec.name}`);
    }
    this._specs.set(spec.name, spec);
    return domainOk(spec);
  }

  get(name: string): SubAgentSpecVO | undefined {
    return this._specs.get(name);
  }

  list(): readonly SubAgentSpecVO[] {
    return Array.from(this._specs.values());
  }

  names(): readonly string[] {
    return Array.from(this._specs.keys());
  }

  has(name: string): boolean {
    return this._specs.has(name);
  }

  /** 仅测试使用 */
  clear(): void {
    this._specs.clear();
  }

  static fromSpecs(specs: readonly SubAgentSpecVO[]): DomainResult<InMemorySubAgentRegistry> {
    const r = new InMemorySubAgentRegistry();
    for (const s of specs) {
      const reg = r.register(s);
      if (!reg.ok) return reg;
    }
    return domainOk(r);
  }
}