/**
 * 016_session_auto_approve — chat_sessions 自动批准开关（阶段 13 / 任务 18）
 *
 * 背景：
 *   - PR #8：用户在 chat 头部开关"全部自动批准"工具调用
 *   - 开关状态属于会话属性，跟着会话走（切回旧会话自动恢复）
 *
 * 设计：
 *   - chat_sessions 增加 auto_approve INTEGER NOT NULL DEFAULT 0
 *     0 = 默认逐个审批；1 = 当前会话所有 requiresApproval 的 tool 全部自动执行
 *
 * 兼容性：
 *   - 列加 DEFAULT，旧数据自动 0
 *   - 不破坏 014 / 015 任何表
 */
export const MIGRATION_016 = {
  id: "016_session_auto_approve",
  sql: `
    ALTER TABLE chat_sessions
      ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;
  `,
};
