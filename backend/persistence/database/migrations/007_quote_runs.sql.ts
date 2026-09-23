/**
 * 007_quote_runs —— 报价单生成历史快照
 *
 * 阶段 7.4f。
 *
 * 设计要点：
 *   - quote_runs 仅缓存"生成时点"的快照（ai_markdown / summary_json / source_snapshot_json）；
 *     主表（function_list / budget_settings / hardware_items）才是真相源。
 *   - output_path 指向 <dataRoot>/projects/<pid>/quotes/<runId>/quote.xlsx；
 *     下载走 QuoteStorage.readXlsx 防路径穿越。
 *   - mime_type 锁定 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet。
 *   - template_id NULL = 使用 app 内置默认模板。
 */

export const MIGRATION_007 = {
  id: "007_quote_runs",
  sql: `
    CREATE TABLE quote_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      template_id TEXT,
      user_input TEXT NOT NULL DEFAULT '',
      ai_markdown TEXT NOT NULL DEFAULT '',
      summary_json TEXT NOT NULL DEFAULT '{}',
      source_snapshot_json TEXT NOT NULL DEFAULT '{}',
      output_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_quote_runs_project ON quote_runs(project_id, created_at DESC);
  `,
};