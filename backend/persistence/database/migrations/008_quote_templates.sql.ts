/**
 * 008_quote_templates —— 报价单 Excel 模板
 *
 * 阶段 7.4f。
 *
 * 设计要点：
 *   - project_id NULL = App 内置默认模板（指向 <dataRoot>/templates/quote-default.xlsx）
 *   - 非空 = 项目上传的定制模板（指向 <dataRoot>/projects/<pid>/quote-templates/...）
 *   - mime 锁定 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *   - 上传时 magic bytes 校验（PK\x03\x04）
 */

export const MIGRATION_008 = {
  id: "008_quote_templates",
  sql: `
    CREATE TABLE quote_templates (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      path_on_disk TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );
    CREATE INDEX idx_quote_templates_project ON quote_templates(project_id, uploaded_at DESC);
  `,
};