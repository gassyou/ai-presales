/**
 * IKnowledgeRepository —— 知识条目仓储接口
 *
 * ai_knowledge 元数据 CRUD；
 * knowledge_chunks 的读写放在 IKnowledgeChunkRepository（6.0c 同目录）。
 */

import type { KnowledgeItemId, ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import { KnowledgeItem, type KnowledgeItemSnapshot } from "./knowledge-item.ts";

export interface KnowledgeItemListFilter {
  projectId: ProjectId;
  limit: number;
  offset: number;
}

export interface KnowledgeItemListResult {
  items: readonly KnowledgeItemSnapshot[];
  total: number;
  limit: number;
  offset: number;
}

export interface IKnowledgeRepository {
  save(item: KnowledgeItem): Promise<DomainResult<void>>;
  findById(id: KnowledgeItemId): Promise<DomainResult<KnowledgeItem>>;
  /** 用于 6.0g 检查"是否已采纳过该消息" + dedupe */
  findBySourceMessage(messageId: string): Promise<KnowledgeItemSnapshot | null>;
  list(filter: KnowledgeItemListFilter): Promise<KnowledgeItemListResult>;
  delete(id: KnowledgeItemId): Promise<DomainResult<void>>;
}