/**
 * 009_project_status_fields — 给 projects 表补 6 列状态切换附加字段
 *
 * 阶段 7.4g：
 *   - won_date / lost_date：仪表盘"年中标数 / 年未中标数"统计口径
 *   - lost_reason / best_practice / improvement_note / pause_reason：
 *     状态切换（中标 / 未中标 / 暂停）时业务侧填写的说明性文本
 *
 * 兼容性：
 *   - 6 条 ALTER 单独执行，迁移 runner 对每条 wrap try/catch，
 *     重复执行（重启时）忽略 "duplicate column name" 错误 —— 等价于幂等
 *   - 旧数据无新列时为 NULL；won_date NULL 时的历史数据兜底走 updated_at 统计
 *
 * 索引：
 *   - idx_projects_created_at_month —— 仪表盘"月度新增案件"
 *   - idx_projects_won_date_year / idx_projects_lost_date_year —— 中标/未中标年度聚合
 *
 * 注意：
 *   - partial index `WHERE won_date IS NOT NULL` 让历史数据（NULL）不占索引体积
 *   - 数据库迁移是阶段 1 单文件，runner 自动按 id 顺序执行
 */
export const MIGRATION_009 = {
  id: "009_project_status_fields",
  sql: `
    ALTER TABLE projects ADD COLUMN won_date TEXT;
    ALTER TABLE projects ADD COLUMN lost_date TEXT;
    ALTER TABLE projects ADD COLUMN lost_reason TEXT;
    ALTER TABLE projects ADD COLUMN best_practice TEXT;
    ALTER TABLE projects ADD COLUMN improvement_note TEXT;
    ALTER TABLE projects ADD COLUMN pause_reason TEXT;
    CREATE INDEX IF NOT EXISTS idx_projects_created_at_month ON projects(strftime('%Y-%m', created_at));
    CREATE INDEX IF NOT EXISTS idx_projects_won_date_year ON projects(strftime('%Y', won_date)) WHERE won_date IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_projects_lost_date_year ON projects(strftime('%Y', lost_date)) WHERE lost_date IS NOT NULL;
  `,
};
