/**
 * IKnowledgeChunkRepository —— chunk 仓储接口
 *
 * 设计：
 *   - saveChunks(chunks) 批量写（同一 knowledgeId 下）
 *   - deleteByKnowledgeId(knowledgeId) 删全部
 *   - listByProject(projectId) 给后台 ingest job 用
 *   - markDirty / clearDirty 用于增量更新
 *   - searchByLike(projectId, query, limit) 软降级路径
 *   - searchByVec(...) 由 SqliteVecKnowledgeChunkRepository 单独实现
 */

import type { KnowledgeItemId, ProjectId } from "@shared/types/ids.ts";
import type { KnowledgeChunk, KnowledgeChunkSnapshot } from "./knowledge-chunk.ts";

export interface IKnowledgeChunkRepository {
  saveChunks(chunks: readonly KnowledgeChunk[]): Promise<void>;
  deleteByKnowledgeId(knowledgeId: KnowledgeItemId): Promise<number>;
  deleteByProject(projectId: ProjectId): Promise<number>;
  listByProject(projectId: ProjectId): Promise<readonly KnowledgeChunkSnapshot[]>;
  /** 软降级路径：LIKE 检索；顺序按 chunkText LIKE 命中位置 */
  searchByLike(
    projectId: ProjectId,
    query: string,
    limit: number,
  ): Promise<readonly KnowledgeChunkSnapshot[]>;
  /** 标记 dirty（增量更新） */
  markDirty(knowledgeId: KnowledgeItemId): Promise<number>;
  clearDirty(ids: readonly string[]): Promise<number>;
  listDirtyByProject(projectId: ProjectId): Promise<readonly KnowledgeChunkSnapshot[]>;
  /** 统计项目下的 chunk 数（>0 即视为已入库，可走 RAG） */
  countByProject(projectId: ProjectId): Promise<number>;
}