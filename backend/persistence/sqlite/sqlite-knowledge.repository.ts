/**
 * SqliteKnowledgeRepository —— ai_knowledge 表 CRUD
 */

import { KnowledgeItemId } from "@shared/types/ids.ts";
import type { KnowledgeItemId as KnowledgeItemIdT, ProjectId } from "@shared/types/ids.ts";
import { KnowledgeItemId as toKnowledgeItemId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";
import type {
  IKnowledgeRepository,
  KnowledgeItemListFilter,
  KnowledgeItemListResult,
} from "@backend/domain/knowledge/knowledge.repository.ts";
import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import { KnowledgeItem, type KnowledgeItemSnapshot, type AdoptionKind } from "@backend/domain/knowledge/knowledge-item.ts";

interface KnowledgeRow {
  id: string;
  project_id: string;
  source_session_id: string | null;
  source_message_id: string | null;
  title: string;
  body: string;
  adopted_at: string;
  adoption_kind: string;
}

function rowToSnapshot(row: KnowledgeRow): KnowledgeItemSnapshot {
  return {
    id: toKnowledgeItemId(row.id),
    projectId: row.project_id as unknown as ProjectId,
    sourceSessionId: row.source_session_id
      ? (row.source_session_id as unknown as KnowledgeItem["sourceSessionIdValue"])
      : null,
    sourceMessageId: row.source_message_id
      ? (row.source_message_id as unknown as KnowledgeItem["sourceMessageIdValue"])
      : null,
    title: row.title,
    body: row.body,
    adoptedAt: new Date(row.adopted_at),
    adoptionKind: row.adoption_kind as AdoptionKind,
  };
}

export class SqliteKnowledgeRepository implements IKnowledgeRepository {
  constructor(private readonly db: Database) {}

  async save(item: KnowledgeItem): Promise<DomainResult<void>> {
    const snap = item.snapshot();
    try {
      this.db.withTransaction(() => {
        this.db.run(
          `INSERT INTO ai_knowledge (id, project_id, source_session_id, source_message_id, title, body, adopted_at, adoption_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id,
             source_session_id = excluded.source_session_id,
             source_message_id = excluded.source_message_id,
             title = excluded.title,
             body = excluded.body,
             adopted_at = excluded.adopted_at,
             adoption_kind = excluded.adoption_kind`,
          [
            snap.id,
            snap.projectId,
            snap.sourceSessionId,
            snap.sourceMessageId,
            snap.title,
            snap.body,
            snap.adoptedAt.toISOString(),
            snap.adoptionKind,
          ] as QueryParam[],
        );
        item.pullDomainEvents();
      });
      return domainOk(undefined);
    } catch (e) {
      return domainErr("INTERNAL", `save knowledge failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async findById(id: KnowledgeItemIdT): Promise<DomainResult<KnowledgeItem>> {
    const row = this.db.queryRow<KnowledgeRow>(
      "SELECT id, project_id, source_session_id, source_message_id, title, body, adopted_at, adoption_kind FROM ai_knowledge WHERE id = ?",
      [id],
    );
    if (!row) return domainErr("NOT_FOUND", `knowledge ${id} not found`);
    return domainOk(KnowledgeItem.rehydrate(rowToSnapshot(row)));
  }

  async findBySourceMessage(messageId: string): Promise<KnowledgeItemSnapshot | null> {
    const row = this.db.queryRow<KnowledgeRow>(
      "SELECT id, project_id, source_session_id, source_message_id, title, body, adopted_at, adoption_kind FROM ai_knowledge WHERE source_message_id = ?",
      [messageId],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async list(filter: KnowledgeItemListFilter): Promise<KnowledgeItemListResult> {
    const totalRow = this.db.queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM ai_knowledge WHERE project_id = ?",
      [filter.projectId],
    );
    const total = totalRow?.c ?? 0;
    const rows = this.db.query<KnowledgeRow>(
      `SELECT id, project_id, source_session_id, source_message_id, title, body, adopted_at, adoption_kind
       FROM ai_knowledge
       WHERE project_id = ?
       ORDER BY adopted_at DESC
       LIMIT ? OFFSET ?`,
      [filter.projectId, filter.limit, filter.offset],
    );
    return {
      items: rows.map(rowToSnapshot),
      total,
      limit: filter.limit,
      offset: filter.offset,
    };
  }

  async delete(id: KnowledgeItemIdT): Promise<DomainResult<void>> {
    const r = this.db.run("DELETE FROM ai_knowledge WHERE id = ?", [id]);
    if (r.changes === 0) return domainErr("NOT_FOUND", `knowledge ${id} not found`);
    return domainOk(undefined);
  }
}