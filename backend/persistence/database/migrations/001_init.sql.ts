/**
 * 001_init — 初始化主库 schema
 *
 * 表：
 *   projects              业务项目聚合根
 *   ai_sessions           AI 会话聚合根
 *   messages              会话内消息（含 role=tool 时的 tool_call_id 关联）
 *   tool_calls            工具调用 + 结果
 *   knowledge_items       已采纳知识（向量备份到 vec_ 表；元数据在主表）
 *
 * 阶段 2 仅启用 projects；其余表随阶段推进追加迁移。
 */

export const MIGRATION_001 = {
  id: "001_init",
  sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
    CREATE INDEX idx_projects_status ON projects(status);

    CREATE TABLE project_code_counters (
      year INTEGER PRIMARY KEY,
      last_value INTEGER NOT NULL
    );
  `,
};