/**
 * SqliteChatAttachmentRepository —— 阶段 13（PR #7）：chat_attachments 表 SQLite 实现
 *
 * 表结构见 `015_chat_attachments.sql.ts`。
 */
import type { Database } from "@backend/persistence/database/database.ts";

export interface ChatAttachmentRecord {
  id: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  parsedSummary: string | null;
  createdAt: Date;
}

export interface ChatAttachmentRecordRead extends ChatAttachmentRecord {}

export interface IChatAttachmentRepository {
  create(r: ChatAttachmentRecord): void;
  listBySession(sessionId: string): ChatAttachmentRecordRead[];
  updateSummary(id: string, summary: string): void;
}

interface AttachmentRow {
  id: string;
  session_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  parsed_summary: string | null;
  created_at: string;
}

export class SqliteChatAttachmentRepository implements IChatAttachmentRepository {
  constructor(private readonly db: Database) {}

  create(r: ChatAttachmentRecord): void {
    this.db.run(
      `INSERT INTO chat_attachments
        (id, session_id, file_name, mime_type, size_bytes, storage_path, parsed_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.sessionId,
        r.fileName,
        r.mimeType,
        r.sizeBytes,
        r.storagePath,
        r.parsedSummary,
        r.createdAt.toISOString(),
      ],
    );
  }

  listBySession(sessionId: string): ChatAttachmentRecordRead[] {
    const rows = this.db.query<AttachmentRow>(
      `SELECT id, session_id, file_name, mime_type, size_bytes, storage_path, parsed_summary, created_at
       FROM chat_attachments WHERE session_id = ? ORDER BY created_at DESC`,
      [sessionId],
    );
    return rows.map((row) => this.toRecord(row));
  }

  updateSummary(id: string, summary: string): void {
    this.db.run(
      `UPDATE chat_attachments SET parsed_summary = ? WHERE id = ?`,
      [summary, id],
    );
  }

  private toRecord(row: AttachmentRow): ChatAttachmentRecordRead {
    return {
      id: row.id,
      sessionId: row.session_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storagePath: row.storage_path,
      parsedSummary: row.parsed_summary,
      createdAt: new Date(row.created_at),
    };
  }
}
