/**
 * AdoptionStatus —— 模块项采纳状态 VO
 *
 * 阶段 7.0。借鉴 6.0c knowledge 的 adoption_kind 思路：
 *   - `pending`   ：刚创建/AI 生成中
 *   - `adopted`   ：用户已确认采纳（进 RAG）
 *   - `unadopted` ：用户标记"不采用"（参与后续 AI 编排时跳过）
 */

import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";

export type AdoptionStatusValue = "pending" | "adopted" | "unadopted";

export class AdoptionStatus {
  private constructor(private readonly _value: AdoptionStatusValue) {}

  static create(v: string): DomainResult<AdoptionStatus> {
    if (v !== "pending" && v !== "adopted" && v !== "unadopted") {
      return domainErr("INVALID_INPUT", `unknown adoption status: ${v}`);
    }
    return domainOk(new AdoptionStatus(v));
  }

  static initial(): AdoptionStatus {
    return new AdoptionStatus("pending");
  }

  get value(): AdoptionStatusValue {
    return this._value;
  }

  /** 是否被采纳（参与 RAG） */
  isAdopted(): boolean {
    return this._value === "adopted";
  }

  /** 是否参与后续 AI 编排（adopted + pending 都参与，unadopted 跳过） */
  participates(): boolean {
    return this._value !== "unadopted";
  }
}
