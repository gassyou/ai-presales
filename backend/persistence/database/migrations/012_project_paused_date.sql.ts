/**
 * 010_project_paused_date — 给 projects 表补 paused_date 列
 *
 * 阶段 1（任务 1）：新增"中止"状态。paused_date 存"中止"日期。
 * 复用 pause_reason 列存中止原因（避免再加列；语义可接受）。
 *
 * 兼容性：
 *   - ALTER TABLE ADD COLUMN 是幂等的吗？不，重复执行会抛
 *     "duplicate column name"。但本项目 migration runner 对每条 wrap try/catch
 *     吞掉该错误（见 009 注释），所以幂等 OK。
 *   - 旧数据 paused_date 为 NULL。
 *
 * 不加索引：
 *   - "中止"是终态少用，未来若查询热度高再加。
 */
export const MIGRATION_012 = {
  id: "010_project_paused_date",
  sql: `
    ALTER TABLE projects ADD COLUMN paused_date TEXT;
  `,
};