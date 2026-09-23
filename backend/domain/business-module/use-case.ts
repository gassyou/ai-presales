/**
 * UseCaseItem —— 核心系统用例类型
 *
 * 阶段 7.4a。
 * 复用 BusinessModuleItem；payloadJson 存 { caseId, businessRules }；
 * content 存详细用例描述（markdown）。
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const USE_CASE_KIND: BusinessModuleKind = "use_case";

export interface UseCasePayload {
  /** 用例编号，例如 "UC-001" */
  caseId: string;
  /** 业务规则说明 */
  businessRules: string;
}

export function makeUseCasePayload(seed: Partial<UseCasePayload> = {}): UseCasePayload {
  return {
    caseId: seed.caseId ?? "",
    businessRules: seed.businessRules ?? "",
  };
}

export function parseUseCasePayload(json: string): UseCasePayload {
  try {
    const obj = JSON.parse(json) as Partial<UseCasePayload>;
    return makeUseCasePayload(obj);
  } catch {
    return makeUseCasePayload();
  }
}
