/**
 * ProjectStatus —— 项目状态机
 *
 * 状态：
 *   新建 ──→ 提案中 ──→ 中标
 *                  ├──→ 暂停 ──→ 提案中
 *                  ├──→ 未中标
 *
 * 不合法跳转返回 DomainError，状态机集中在 VO 里而非聚合根，
 * 让"状态"也能脱离聚合根单独被测试。
 */

import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";

export type ProjectStatusValue = "新建" | "提案中" | "暂停" | "中标" | "未中标";

export const PROJECT_STATUSES: readonly ProjectStatusValue[] = [
  "新建",
  "提案中",
  "暂停",
  "中标",
  "未中标",
] as const;

const TRANSITIONS: Record<ProjectStatusValue, readonly ProjectStatusValue[]> = {
  "新建": ["提案中"],
  "提案中": ["暂停", "中标", "未中标"],
  "暂停": ["提案中", "未中标"],
  "中标": [],
  "未中标": [],
};

export class ProjectStatus {
  private readonly current: ProjectStatusValue;

  private constructor(value: ProjectStatusValue) {
    this.current = value;
  }

  static create(value: string): DomainResult<ProjectStatus> {
    if (!PROJECT_STATUSES.includes(value as ProjectStatusValue)) {
      return domainErr(
        "INVALID_INPUT",
        `invalid project status: ${value}`,
        { allowed: PROJECT_STATUSES },
      );
    }
    return domainOk(new ProjectStatus(value as ProjectStatusValue));
  }

  /** 初始状态 */
  static initial(): ProjectStatus {
    return new ProjectStatus("新建");
  }

  get value(): ProjectStatusValue {
    return this.current;
  }

  equals(other: ProjectStatus): boolean {
    return this.current === other.current;
  }

  /** 检查 from → to 是否合法 */
  canTransitionTo(target: ProjectStatusValue): boolean {
    return TRANSITIONS[this.current].includes(target);
  }

  /** 状态变更；非法跳转返回错误 */
  transition(target: ProjectStatusValue): DomainResult<ProjectStatus> {
    if (this.current === target) {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        "already in status",
        { current: this.current },
      );
    }
    if (!this.canTransitionTo(target)) {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot transition ${this.current} → ${target}`,
        { from: this.current, to: target, allowed: TRANSITIONS[this.current] },
      );
    }
    return domainOk(new ProjectStatus(target));
  }
}