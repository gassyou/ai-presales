/**
 * 内置迁移注册 —— 启动期传给 runner
 */

import { MIGRATION_001 } from "./001_init.sql.ts";
import { MIGRATION_002 } from "./002_ai_memory.sql.ts";
import { MIGRATION_003 } from "./003_knowledge.sql.ts";
import { MIGRATION_004 } from "./004_business_module.sql.ts";
import { MIGRATION_005 } from "./005_ppt_pages.sql.ts";
import { MIGRATION_006 } from "./006_contacts_and_emails.sql.ts";
import { MIGRATION_007 } from "./007_quote_runs.sql.ts";
import { MIGRATION_008 } from "./008_quote_templates.sql.ts";
import { MIGRATION_009 } from "./009_project_status_fields.sql.ts";
import { MIGRATION_010 } from "./010_system_settings.sql.ts";
import { MIGRATION_011 } from "./011_project_metadata.sql.ts";
import { MIGRATION_012 } from "./012_project_paused_date.sql.ts";
import { MIGRATION_013 } from "./013_project_workspace.sql.ts";
import { MIGRATION_014 } from "./014_chat_sessions.sql.ts";
import { MIGRATION_015 } from "./015_chat_attachments.sql.ts";
import { MIGRATION_016 } from "./016_session_auto_approve.sql.ts";
import type { Migration } from "./runner.ts";

export const BUILTIN_MIGRATIONS: readonly Migration[] = [
  MIGRATION_001,
  MIGRATION_002,
  MIGRATION_003,
  MIGRATION_004,
  MIGRATION_005,
  MIGRATION_006,
  MIGRATION_007,
  MIGRATION_008,
  MIGRATION_009,
  MIGRATION_010,
  MIGRATION_011,
  MIGRATION_012,
  MIGRATION_013,
  MIGRATION_014,
  MIGRATION_015,
  MIGRATION_016,
];
