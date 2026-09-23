/**
 * 阶段 7.4h：系统设置持久化表 + 邮件失败字段
 *
 * 单 key 单行（无业务 history），key=设置类别（llm.profiles / mail.accounts / tools.configs / agents.specs）。
 * value_json 为全集序列化；updated_at 用于乐观并发。
 *
 * 同时 ALTER emails 表加 failed_at + error_message 列（迁移 runner 通过 splitStatements + execIdempotent
 * 自动跳过重复列）。
 */

export const MIGRATION_010 = {
  id: "010_system_settings",
  sql: `
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_system_settings_updated_at ON system_settings(updated_at DESC);

    ALTER TABLE emails ADD COLUMN failed_at TEXT;
    ALTER TABLE emails ADD COLUMN error_message TEXT;
  `,
};