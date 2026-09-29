/**
 * 014_chat_sessions — AI chat 会话与消息持久化（阶段 6 / 任务 6）
 *
 * 设计：
 *   - chat_sessions 会话（可关联到 project，可独立存在 = 全局对话）
 *     id            TEXT PK (UUID)
 *     project_id    TEXT NULL（关联项目 id；null = 全局会话）
 *     title         TEXT NOT NULL（首条消息的截断，或用户自定义）
 *     created_at    TEXT NOT NULL (ISO)
 *     updated_at    TEXT NOT NULL (ISO)
 *   - chat_messages 会话内消息
 *     id            TEXT PK
 *     session_id    TEXT NOT NULL FK → chat_sessions(id)
 *     role          TEXT NOT NULL（'user'|'assistant'|'tool'|'system'）
 *     content       TEXT NOT NULL
 *     tool_calls_json TEXT NULL（assistant 消息带的 tool_call/tool_result 序列）
 *     created_at    TEXT NOT NULL (ISO)
 *
 * 索引：
 *   - chat_messages(session_id, created_at) —— 列出会话历史
 *   - chat_sessions(project_id, updated_at DESC) —— 按项目找最近会话
 *
 * 兼容性：旧数据无新表 → 不影响。
 */
export const MIGRATION_014 = {
  id: "014_chat_sessions",
  sql: `
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_project_updated
      ON chat_sessions(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
      ON chat_messages(session_id, created_at);
  `,
};