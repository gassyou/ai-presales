/**
 * SqliteQuoteRunsRepository —— quote_runs 表 CRUD
 *
 * 阶段 7.4f。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";

export interface QuoteRunSnapshot {
  id: string;
  projectId: ProjectId;
  templateId: string | null;
  userInput: string;
  aiMarkdown: string;
  summaryJson: string;
  sourceSnapshotJson: string;
  outputPath: string;
  mimeType: string;
  createdAt: string; // ISO
}

interface QuoteRunRow {
  id: string;
  project_id: string;
  template_id: string | null;
  user_input: string;
  ai_markdown: string;
  summary_json: string;
  source_snapshot_json: string;
  output_path: string;
  mime_type: string;
  created_at: string;
}

function rowToSnapshot(row: QuoteRunRow): QuoteRunSnapshot {
  return {
    id: row.id,
    projectId: toProjectId(row.project_id),
    templateId: row.template_id,
    userInput: row.user_input,
    aiMarkdown: row.ai_markdown,
    summaryJson: row.summary_json,
    sourceSnapshotJson: row.source_snapshot_json,
    outputPath: row.output_path,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

export interface IQuoteRunsRepository {
  listByProject(projectId: ProjectId): Promise<QuoteRunSnapshot[]>;
  findById(id: string): Promise<QuoteRunSnapshot | null>;
  insert(snap: QuoteRunSnapshot): Promise<void>;
  delete(id: string): Promise<void>;
}

export class SqliteQuoteRunsRepository implements IQuoteRunsRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: ProjectId): Promise<QuoteRunSnapshot[]> {
    const rows = this.db.query<QuoteRunRow>(
      `SELECT * FROM quote_runs WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: string): Promise<QuoteRunSnapshot | null> {
    const row = this.db.queryRow<QuoteRunRow>(
      "SELECT * FROM quote_runs WHERE id = ?",
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async insert(snap: QuoteRunSnapshot): Promise<void> {
    this.db.run(
      `INSERT INTO quote_runs
        (id, project_id, template_id, user_input, ai_markdown, summary_json,
         source_snapshot_json, output_path, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snap.id,
        snap.projectId,
        snap.templateId,
        snap.userInput,
        snap.aiMarkdown,
        snap.summaryJson,
        snap.sourceSnapshotJson,
        snap.outputPath,
        snap.mimeType,
        snap.createdAt,
      ] as QueryParam[],
    );
  }

  async delete(id: string): Promise<void> {
    this.db.run("DELETE FROM quote_runs WHERE id = ?", [id]);
  }
}