/**
 * 005_ppt_pages —— 提案 PPT 设计专用表
 *
 * 阶段 7.4c。一页一行；ordinal 用于排序 + 导出；
 * position_x / position_y / width / height 是便签画布坐标。
 *
 * 设计要点：
 *   - 与 business_module_items 解耦（高频流式写 + 专用索引）
 *   - 按 (project_id, ordinal) 建索引 → 列表 + reorder 走索引扫描
 *   - ON DELETE CASCADE：项目删除时清空 PPT 页
 */

export const MIGRATION_005 = {
  id: "005_ppt_pages",
  sql: `
    CREATE TABLE ppt_pages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      position_x INTEGER NOT NULL DEFAULT 0,
      position_y INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 220,
      height INTEGER NOT NULL DEFAULT 140,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_ppt_pages_project_ordinal
      ON ppt_pages(project_id, ordinal);
  `,
};