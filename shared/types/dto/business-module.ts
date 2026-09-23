/**
 * BusinessModuleDTO —— 业务模块条目 DTO
 *
 * 阶段 7.0。前后端共用的"业务模块条目"传输形态。
 */

import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";

export type AdoptionStatusDTO = "pending" | "adopted" | "unadopted";

export interface BusinessModuleItemDTO {
  readonly id: string;
  readonly projectId: string;
  readonly kind: BusinessModuleKind;
  readonly title: string;
  readonly content: string;
  readonly status: AdoptionStatusDTO;
  readonly payloadJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBusinessModuleItemDTO {
  readonly title: string;
  readonly content?: string;
  readonly payloadJson?: string;
  readonly initialStatus?: AdoptionStatusDTO;
}

export interface UpdateBusinessModuleItemDTO {
  readonly title?: string;
  readonly content?: string;
  readonly payloadJson?: string;
  readonly status?: AdoptionStatusDTO;
}
