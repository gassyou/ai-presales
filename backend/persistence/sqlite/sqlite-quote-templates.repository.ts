/**
 * SqliteQuoteTemplatesRepository —— quote_templates 表 CRUD
 *
 * 阶段 7.4f。
 *
 * 设计要点：
 *   - project_id NULL = App 内置默认模板（指向 <dataRoot>/templates/quote-default.xlsx）
 *   - listForProject(pid) 同时返回内置默认 + 项目上传的
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";

export interface QuoteTemplateSnapshot {
  id: string;
  filename: string;
  originalFilename: string;
  mime: string;
  size: number;
  projectId: ProjectId | null; // null = 内置默认
  pathOnDisk: string;
  uploadedAt: string; // ISO
}

interface QuoteTemplateRow {
  id: string;
  filename: string;
  original_filename: string;
  mime: string;
  size: number;
  project_id: string | null;
  path_on_disk: string;
  uploaded_at: string;
}

function rowToSnapshot(row: QuoteTemplateRow): QuoteTemplateSnapshot {
  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    mime: row.mime,
    size: row.size,
    projectId: row.project_id ? toProjectId(row.project_id) : null,
    pathOnDisk: row.path_on_disk,
    uploadedAt: row.uploaded_at,
  };
}

export interface IQuoteTemplatesRepository {
  findById(id: string): Promise<QuoteTemplateSnapshot | null>;
  findDefault(): Promise<QuoteTemplateSnapshot | null>;
  listForProject(projectId: ProjectId): Promise<QuoteTemplateSnapshot[]>;
  insert(snap: QuoteTemplateSnapshot): Promise<void>;
  delete(id: string): Promise<void>;
}

export class SqliteQuoteTemplatesRepository implements IQuoteTemplatesRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<QuoteTemplateSnapshot | null> {
    const row = this.db.queryRow<QuoteTemplateRow>(
      "SELECT * FROM quote_templates WHERE id = ?",
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async findDefault(): Promise<QuoteTemplateSnapshot | null> {
    // 内置默认模板：用固定虚拟 id "__default__" 或按 project_id IS NULL 查最新一条
    const row = this.db.queryRow<QuoteTemplateRow>(
      "SELECT * FROM quote_templates WHERE project_id IS NULL ORDER BY uploaded_at DESC LIMIT 1",
    );
    return row ? rowToSnapshot(row) : null;
  }

  async listForProject(projectId: ProjectId): Promise<QuoteTemplateSnapshot[]> {
    const rows = this.db.query<QuoteTemplateRow>(
      `SELECT * FROM quote_templates
       WHERE project_id IS NULL OR project_id = ?
       ORDER BY project_id ASC, uploaded_at DESC`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async insert(snap: QuoteTemplateSnapshot): Promise<void> {
    this.db.run(
      `INSERT INTO quote_templates
        (id, filename, original_filename, mime, size, project_id, path_on_disk, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snap.id,
        snap.filename,
        snap.originalFilename,
        snap.mime,
        snap.size,
        snap.projectId,
        snap.pathOnDisk,
        snap.uploadedAt,
      ] as QueryParam[],
    );
  }

  async delete(id: string): Promise<void> {
    this.db.run("DELETE FROM quote_templates WHERE id = ?", [id]);
  }
}