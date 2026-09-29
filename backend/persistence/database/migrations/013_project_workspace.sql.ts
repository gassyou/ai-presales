/**
 * 013_project_workspace — 给 projects 表补 workspace_path 列
 *
 * 阶段 2（任务 2）：项目工作区。
 *   - 字段：projects.workspace_path TEXT
 *   - 含义：AI 工具读/写文件时使用的根目录（可选）
 *   - 默认策略：未指定时 = ~/Desktop/<projectCode>
 *   - 一键创建：set_workspace 工具/mutation；不存在时 mkdirSync(recursive: true)
 *   - 已存在：不创建（直接使用）
 *
 * 兼容性：
 *   - ALTER ADD COLUMN 经 runner try/catch 吞 duplicate-column 错误 → 幂等
 *   - 旧数据 workspace_path 为 NULL → 调用方按默认策略解析
 *
 * 不加索引：workspace_path 用得少；未来按项目查文件等场景才需要。
 */
export const MIGRATION_013 = {
  id: "013_project_workspace",
  sql: `
    ALTER TABLE projects ADD COLUMN workspace_path TEXT;
  `,
};