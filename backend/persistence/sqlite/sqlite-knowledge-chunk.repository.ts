/**
 * SqliteKnowledgeChunkRepository —— knowledge_chunks 表
 *
 * 实现 IKnowledgeChunkRepository 的"通用"部分：
 *   - save / delete / list / markDirty / clearDirty / searchByLike
 *   - 不做 vec0 cosine 检索（那是 VecKnowledgeChunkRepository 的事）
 *   - vec0 装载状态通过 readVecStatus() / writeVecStatus() 维护
 *
 * 检索策略：
 *   - vec0 装载成功 → 走 vec_distance_cosine (VecKnowledgeChunkRepository.searchByVec)
 *   - 失败 / 缺失 → 降级 LIKE 检索（searchByLike）
 *   - 派发由 application/knowledge/retrieve.ts 决定
 */

import type { KnowledgeItemId, ProjectId } from "@shared/types/ids.ts";
import { KnowledgeItemId as toKnowledgeItemId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";
import {
  type ChunkSourceKind,
  KnowledgeChunk,
  type KnowledgeChunkSnapshot,
} from "@backend/domain/knowledge/knowledge-chunk.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";

interface ChunkRow {
  id: string;
  knowledge_id: string;
  project_id: string;
  source_kind: string;
  source_ref: string | null;
  ordinal: number;
  chunk_text: string;
  token_count: number;
  embedding_model: string;
  embedding_dim: number;
  vec_blob: Uint8Array | null;
  is_dirty: number;
  created_at: string;
  updated_at: string;
}

export type VecStatus = "loaded" | "missing" | "failed";

export interface VecStatusRecord {
  status: VecStatus;
  reason: string | null;
  loadedAt: Date;
}

function rowToSnapshot(row: ChunkRow): KnowledgeChunkSnapshot {
  return {
    id: row.id,
    knowledgeId: toKnowledgeItemId(row.knowledge_id),
    projectId: row.project_id as unknown as ProjectId,
    sourceKind: row.source_kind as ChunkSourceKind,
    sourceRef: row.source_ref,
    ordinal: row.ordinal,
    chunkText: row.chunk_text,
    tokenCount: row.token_count,
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    vecBlob: row.vec_blob,
    isDirty: row.is_dirty === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteKnowledgeChunkRepository implements IKnowledgeChunkRepository {
  constructor(private readonly db: Database) {}

  async saveChunks(chunks: readonly KnowledgeChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    this.db.withTransaction(() => {
      for (const c of chunks) {
        this.db.run(
          `INSERT INTO knowledge_chunks (id, knowledge_id, project_id, source_kind, source_ref, ordinal, chunk_text, token_count, embedding_model, embedding_dim, vec_blob, is_dirty, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             chunk_text = excluded.chunk_text,
             token_count = excluded.token_count,
             embedding_model = excluded.embedding_model,
             embedding_dim = excluded.embedding_dim,
             vec_blob = excluded.vec_blob,
             is_dirty = excluded.is_dirty,
             updated_at = excluded.updated_at`,
          [
            c.id,
            c.knowledgeId,
            c.projectIdValue,
            c.sourceKindValue,
            c.sourceRef,
            c.ordinalValue,
            c.chunkText,
            c.tokenCountValue,
            c.embeddingModel,
            c.embeddingDimValue,
            c.vecBlob,
            c.isDirty ? 1 : 0,
            c.createdAtValue.toISOString(),
            c.updatedAtValue.toISOString(),
          ] as QueryParam[],
        );
      }
    });
  }

  async deleteByKnowledgeId(knowledgeId: KnowledgeItemId): Promise<number> {
    return this.db.run("DELETE FROM knowledge_chunks WHERE knowledge_id = ?", [knowledgeId]).changes;
  }

  async deleteByProject(projectId: ProjectId): Promise<number> {
    return this.db.run("DELETE FROM knowledge_chunks WHERE project_id = ?", [projectId]).changes;
  }

  async listByProject(projectId: ProjectId): Promise<readonly KnowledgeChunkSnapshot[]> {
    const rows = this.db.query<ChunkRow>(
      "SELECT id, knowledge_id, project_id, source_kind, source_ref, ordinal, chunk_text, token_count, embedding_model, embedding_dim, vec_blob, is_dirty, created_at, updated_at FROM knowledge_chunks WHERE project_id = ? ORDER BY knowledge_id, ordinal",
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async searchByLike(
    projectId: ProjectId,
    query: string,
    limit: number,
  ): Promise<readonly KnowledgeChunkSnapshot[]> {
    const q = `%${query.trim()}%`;
    if (!query.trim()) return [];
    const rows = this.db.query<ChunkRow>(
      `SELECT id, knowledge_id, project_id, source_kind, source_ref, ordinal, chunk_text, token_count, embedding_model, embedding_dim, vec_blob, is_dirty, created_at, updated_at
       FROM knowledge_chunks
       WHERE project_id = ? AND chunk_text LIKE ?
       ORDER BY ordinal
       LIMIT ?`,
      [projectId, q, limit],
    );
    return rows.map(rowToSnapshot);
  }

  async markDirty(knowledgeId: KnowledgeItemId): Promise<number> {
    return this.db.run(
      "UPDATE knowledge_chunks SET is_dirty = 1, updated_at = ? WHERE knowledge_id = ?",
      [new Date().toISOString(), knowledgeId],
    ).changes;
  }

  async clearDirty(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    return this.db.run(
      `UPDATE knowledge_chunks SET is_dirty = 0, updated_at = ? WHERE id IN (${placeholders})`,
      [new Date().toISOString(), ...ids],
    ).changes;
  }

  async listDirtyByProject(projectId: ProjectId): Promise<readonly KnowledgeChunkSnapshot[]> {
    const rows = this.db.query<ChunkRow>(
      `SELECT id, knowledge_id, project_id, source_kind, source_ref, ordinal, chunk_text, token_count, embedding_model, embedding_dim, vec_blob, is_dirty, created_at, updated_at
       FROM knowledge_chunks
       WHERE project_id = ? AND is_dirty = 1`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async countByProject(projectId: ProjectId): Promise<number> {
    const row = this.db.queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM knowledge_chunks WHERE project_id = ?",
      [projectId],
    );
    return row?.c ?? 0;
  }

  // ---------- vec status ----------

  readVecStatus(): VecStatusRecord | null {
    const row = this.db.queryRow<{ status: string; reason: string | null; loaded_at: string }>(
      "SELECT status, reason, loaded_at FROM knowledge_vec_status WHERE id = 1",
    );
    if (!row) return null;
    return {
      status: row.status as VecStatus,
      reason: row.reason,
      loadedAt: new Date(row.loaded_at),
    };
  }

  writeVecStatus(status: VecStatus, reason: string | null = null): void {
    this.db.run(
      `INSERT INTO knowledge_vec_status (id, status, reason, loaded_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         loaded_at = excluded.loaded_at`,
      [status, reason, new Date().toISOString()],
    );
  }
}