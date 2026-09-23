/**
 * 002_ai_memory — AI 会话 / 消息 / 知识 / 知识块表
 *
 * 设计要点：
 *   - ai_sessions：会话聚合根元数据；不带 messages（拆表存）
 *   - ai_messages：会话内消息；toolCalls / sourceProjectIds / citedMessageIds 用 JSON 列
 *   - ai_knowledge：已采纳知识条目
 *   - knowledge_chunks：chunk 级向量化存储；is_dirty 标记支持增量更新
 *   - ai_message_cites：引用计分（替代 citedMessageIds 列里 JSON parse，性能更好）
 *
 * 阶段 6.0a 仅启用 ai_sessions / ai_messages / ai_message_cites；
 * ai_knowledge / knowledge_chunks 在 6.0c 一并启用。
 *
 * 注意：
 *   - 所有时间戳列用 TEXT ISO-8601；不依赖 SQLite datetime 函数（避免时区歧义）
 *   - 引用 FK ON DELETE CASCADE → 删除项目/会话/消息自动清理下游
 *   - 索引按查询热路径建
 */

export const MIGRATION_002 = {
  id: "002_ai_memory",
  sql: `
    CREATE TABLE ai_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      sub_agent_name TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',  -- active | completed | aborted
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expire_at TEXT
    );

    CREATE INDEX idx_ai_sessions_project ON ai_sessions(project_id, updated_at DESC);
    CREATE INDEX idx_ai_sessions_status ON ai_sessions(status) WHERE status = 'active';
    CREATE INDEX idx_ai_sessions_expire ON ai_sessions(expire_at) WHERE status = 'active';

    CREATE TABLE ai_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,                          -- user | assistant | system | tool
      content TEXT NOT NULL,
      tool_calls_json TEXT NOT NULL DEFAULT '[]',
      source_project_ids_json TEXT NOT NULL DEFAULT '[]',
      cited_message_ids_json TEXT NOT NULL DEFAULT '[]',
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_ai_messages_session ON ai_messages(session_id, created_at);
    CREATE INDEX idx_ai_messages_role ON ai_messages(role);

    CREATE TABLE ai_message_cites (
      session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
      cite_count INTEGER NOT NULL DEFAULT 0,
      last_cited_at TEXT NOT NULL,
      PRIMARY KEY (message_id)
    );

    CREATE INDEX idx_ai_message_cites_count ON ai_message_cites(cite_count DESC);
    CREATE INDEX idx_ai_message_cites_session ON ai_message_cites(session_id);
  `,
};