/**
 * 006_contacts_and_emails —— 项目联系人 / 团队成员 / 邮件 + 附件
 *
 * 阶段 7.4e。
 *
 * 设计要点：
 *   - 4 张独立表（FK→projects/emails，ON DELETE CASCADE）
 *   - contacts.is_primary 唯一索引（同一项目仅 1 个主联系人）
 *   - emails.to_json / cc_json 存 [{name,email}]（轻量收件人快照；不存联系人画像）
 *   - email_attachments.path_on_disk 存绝对路径；下载走 realpath 防穿越
 */

export const MIGRATION_006 = {
  id: "006_contacts_and_emails",
  sql: `
    CREATE TABLE project_contacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_project_contacts_project ON project_contacts(project_id);
    CREATE UNIQUE INDEX idx_project_contacts_primary
      ON project_contacts(project_id) WHERE is_primary = 1;

    CREATE TABLE project_team_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_project_team_members_project ON project_team_members(project_id);

    CREATE TABLE emails (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX idx_emails_project ON emails(project_id, created_at DESC);

    CREATE TABLE email_attachments (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path_on_disk TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_email_attachments_email ON email_attachments(email_id);
  `,
};