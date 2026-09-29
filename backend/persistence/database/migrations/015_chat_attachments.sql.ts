/**
 * 015_chat_attachments — AI chat 附件上传（阶段 13 / PR #7 / 用户项 #8）
 *
 * 表：
 *   chat_attachments
 *     id            TEXT PK (UUID)
 *     session_id    TEXT NOT NULL FK → chat_sessions(id) ON DELETE CASCADE
 *     file_name     TEXT NOT NULL
 *     mime_type     TEXT NOT NULL
 *     size_bytes    INTEGER NOT NULL
 *     storage_path  TEXT NOT NULL（相对 dataDir/chat-attachments/<sessionId>/<id>_<file>）
 *     parsed_summary TEXT NULL（LLM 解析结果）
 *     created_at    TEXT NOT NULL (ISO)
 *
 * 索引：
 *   - chat_attachments(session_id, created_at DESC) —— 列 session 的附件
 *
 * 兼容性：新表，旧数据无影响。
 */
export const MIGRATION_015 = {
  id: "015_chat_attachments",
  sql: `
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      parsed_summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_session_created
      ON chat_attachments(session_id, created_at DESC);
  `,
};
