/**
 * 003_knowledge — 已采纳知识 + chunk 表
 *
 * 表：
 *   ai_knowledge            已采纳条目元数据
 *   knowledge_chunks        chunk 级向量化存储（含 vec_blob + dirty 标记）
 *   knowledge_vec_status    vec0 装载状态（载入/缺失/失败原因）
 *
 * 阶段 6.0c 启用。
 */

export const MIGRATION_003 = {
  id: "003_knowledge",
  sql: `
    CREATE TABLE ai_knowledge (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      -- source_session_id / source_message_id 是软引用：knowledge 是持久的，
      source_session_id TEXT,                       -- ai_sessions(id) 的软引用（避免会话清理时连锁丢知识）
      source_message_id TEXT,                     -- ai_messages(id) 的软引用（同上）
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      adopted_at TEXT NOT NULL,
      adoption_kind TEXT NOT NULL                  -- manual | auto_high_cited
    );

    CREATE INDEX idx_ai_knowledge_project ON ai_knowledge(project_id, adopted_at DESC);
    CREATE UNIQUE INDEX idx_ai_knowledge_source_msg ON ai_knowledge(source_message_id) WHERE source_message_id IS NOT NULL;

    CREATE TABLE knowledge_chunks (
      id TEXT PRIMARY KEY,
      knowledge_id TEXT NOT NULL REFERENCES ai_knowledge(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL,                   -- message | module_summary | file | manual
      source_ref TEXT,                             -- e.g. message_id / module_name / file_path
      ordinal INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding_model TEXT NOT NULL,               -- 'nomic-embed-text@<commit>'
      embedding_dim INTEGER NOT NULL,
      vec_blob BLOB,                               -- Float32[] little-endian；vec 缺失时 NULL，降级 LIKE
      is_dirty INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_knowledge_chunks_project ON knowledge_chunks(project_id, source_kind);
    CREATE INDEX idx_knowledge_chunks_knowledge ON knowledge_chunks(knowledge_id, ordinal);
    CREATE INDEX idx_knowledge_chunks_dirty ON knowledge_chunks(is_dirty) WHERE is_dirty = 1;

    CREATE TABLE knowledge_vec_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),       -- 单行
      status TEXT NOT NULL,                        -- loaded | missing | failed
      reason TEXT,
      loaded_at TEXT NOT NULL
    );
  `,
};