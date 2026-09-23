/**
 * SqlitePptPagesRepository —— ppt_pages 表 CRUD
 *
 * 阶段 7.4c。独立仓储，避免污染通用 business_module_items 路径。
 *
 * 设计：
 *   - listByProject：按 ordinal ASC, created_at ASC 排序
 *   - reorderBulk：单事务批量更新 ordinal（拖拽排序）
 *   - update：行级 patch（不更新 createdAt）
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";
import type { PptPagePatch, PptPageSnapshot } from "@backend/domain/business-module/ppt-page.ts";

interface PptPageRow {
  id: string;
  project_id: string;
  ordinal: number;
  title: string;
  prompt: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

function rowToSnapshot(row: PptPageRow): PptPageSnapshot {
  return {
    id: row.id,
    projectId: toProjectId(row.project_id),
    ordinal: row.ordinal,
    title: row.title,
    prompt: row.prompt,
    positionX: row.position_x,
    positionY: row.position_y,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface IPptPagesRepository {
  listByProject(projectId: ProjectId): Promise<PptPageSnapshot[]>;
  findById(id: string): Promise<PptPageSnapshot | null>;
  insert(snap: PptPageSnapshot): Promise<void>;
  update(id: string, patch: PptPagePatch, updatedAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
  reorderBulk(orderedIds: readonly string[], projectId: ProjectId, updatedAt: Date): Promise<void>;
}

export class SqlitePptPagesRepository implements IPptPagesRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: ProjectId): Promise<PptPageSnapshot[]> {
    const rows = this.db.query<PptPageRow>(
      `SELECT * FROM ppt_pages
       WHERE project_id = ?
       ORDER BY ordinal ASC, created_at ASC`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: string): Promise<PptPageSnapshot | null> {
    const row = this.db.queryRow<PptPageRow>(
      "SELECT * FROM ppt_pages WHERE id = ?",
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async insert(snap: PptPageSnapshot): Promise<void> {
    this.db.run(
      `INSERT INTO ppt_pages
        (id, project_id, ordinal, title, prompt, position_x, position_y, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snap.id,
        snap.projectId,
        snap.ordinal,
        snap.title,
        snap.prompt,
        snap.positionX,
        snap.positionY,
        snap.width,
        snap.height,
        snap.createdAt,
        snap.updatedAt,
      ] as QueryParam[],
    );
  }

  async update(id: string, patch: PptPagePatch, updatedAt: Date): Promise<void> {
    const sets: string[] = [];
    const params: QueryParam[] = [];
    if (patch.ordinal !== undefined) {
      sets.push("ordinal = ?");
      params.push(patch.ordinal);
    }
    if (patch.title !== undefined) {
      sets.push("title = ?");
      params.push(patch.title);
    }
    if (patch.prompt !== undefined) {
      sets.push("prompt = ?");
      params.push(patch.prompt);
    }
    if (patch.positionX !== undefined) {
      sets.push("position_x = ?");
      params.push(patch.positionX);
    }
    if (patch.positionY !== undefined) {
      sets.push("position_y = ?");
      params.push(patch.positionY);
    }
    if (patch.width !== undefined) {
      sets.push("width = ?");
      params.push(patch.width);
    }
    if (patch.height !== undefined) {
      sets.push("height = ?");
      params.push(patch.height);
    }
    sets.push("updated_at = ?");
    params.push(updatedAt.toISOString());
    params.push(id);
    this.db.run(`UPDATE ppt_pages SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  async delete(id: string): Promise<void> {
    this.db.run("DELETE FROM ppt_pages WHERE id = ?", [id]);
  }

  async reorderBulk(
    orderedIds: readonly string[],
    projectId: ProjectId,
    updatedAt: Date,
  ): Promise<void> {
    this.db.withTransaction(() => {
      const ts = updatedAt.toISOString();
      let ordinal = 0;
      for (const id of orderedIds) {
        this.db.run(
          `UPDATE ppt_pages SET ordinal = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`,
          [ordinal, ts, id, projectId] as QueryParam[],
        );
        ordinal++;
      }
    });
  }
}