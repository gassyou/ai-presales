/**
 * 004_business_module —— 业务模块条目统一表
 *
 * 阶段 7.0。把 20 个业务模块的"条目"用一张表承载：
 *   - markdown_* 形态：content 存正文（用于 RAG + 下载）
 *   - 结构化形态：payload_json 存 JSON（功能列表 / 调查问卷 / 预算等）
 *   - status：pending | adopted | unadopted（AI 编排只看到 adopted + pending）
 *   - kind：枚举（见 BusinessModuleKind）
 *
 * 设计要点：
 *   - 单一项目 + kind 下可有多条（项目推进活动、调查任务、问卷条目、功能列表条目、PPT 页等）
 *   - markdown_* 模块通常 1 条（项目级），但允许多条（同一项目分版本/分段）
 *   - 按 (project_id, kind, updated_at desc) 建索引
 */

export const MIGRATION_004 = {
  id: "004_business_module",
  sql: `
    CREATE TABLE business_module_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                          -- BusinessModuleKind 枚举
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',            -- markdown 正文；结构化形态留空
      status TEXT NOT NULL DEFAULT 'pending',      -- pending | adopted | unadopted
      payload_json TEXT NOT NULL DEFAULT '{}',     -- 结构化形态的 JSON 载荷
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_business_module_items_project_kind
      ON business_module_items(project_id, kind, updated_at DESC);
    CREATE INDEX idx_business_module_items_status
      ON business_module_items(project_id, kind, status) WHERE status = 'adopted';
  `,
};
