/**
 * 011_project_metadata — 给 projects 表补 5 列可编辑元信息
 *
 * 字段：
 *   - client_website    客户网站 URL
 *   - client_intro      客户简介（自由文本）
 *   - project_intro     项目简介（自由文本）
 *   - start_date        开始时间（ISO8601 TEXT）
 *   - end_date          结束时间（ISO8601 TEXT）
 *
 * 兼容性：
 *   - 全部可空；旧数据为 NULL
 *   - 迁移 runner 对单条 ALTER 幂等（duplicate column name 静默跳过）
 *   - 不加索引 —— 详情页按主键查，无需索引
 */
export const MIGRATION_011 = {
  id: "011_project_metadata",
  sql: `
    ALTER TABLE projects ADD COLUMN client_website TEXT;
    ALTER TABLE projects ADD COLUMN client_intro TEXT;
    ALTER TABLE projects ADD COLUMN project_intro TEXT;
    ALTER TABLE projects ADD COLUMN start_date TEXT;
    ALTER TABLE projects ADD COLUMN end_date TEXT;
  `,
};
