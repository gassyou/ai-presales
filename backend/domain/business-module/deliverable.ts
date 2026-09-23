/**
 * DeliverableItem —— 交付物类型
 *
 * 阶段 7.4a。
 * 复用 BusinessModuleItem；payloadJson 存 { type, owner, dueDate, status }
 * type: 文档 / 软件 / 服务 / 培训 等
 * status: 未开始 / 进行中 / 已完成 / 已取消
 */

import type { BusinessModuleKind } from "./business-module.ts";

export const DELIVERABLE_KIND: BusinessModuleKind = "deliverable";

export type DeliverableStatus = "not_started" | "in_progress" | "completed" | "cancelled";

export interface DeliverablePayload {
  type: string;
  owner?: string;
  dueDate?: string;
  status: DeliverableStatus;
}

export function makeDeliverablePayload(seed: Partial<DeliverablePayload> = {}): DeliverablePayload {
  return {
    type: seed.type ?? "文档",
    status: seed.status ?? "not_started",
    ...(seed.owner !== undefined ? { owner: seed.owner } : {}),
    ...(seed.dueDate !== undefined ? { dueDate: seed.dueDate } : {}),
  };
}

export function parseDeliverablePayload(json: string): DeliverablePayload {
  try {
    const obj = JSON.parse(json) as Partial<DeliverablePayload>;
    return makeDeliverablePayload(obj);
  } catch {
    return makeDeliverablePayload();
  }
}
