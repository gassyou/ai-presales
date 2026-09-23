/**
 * 迁移执行器 —— 启动期按顺序应用未执行的迁移
 *
 * 协议：
 *   - schema_migrations(id, applied_at) — id 形如 "NNN_xxx"
 *   - 每一迁移在事务内执行
 *   - 迁移 SQL 由调用方传入（test 时直接注入；prod 时由嵌入的 migrations 列表）
 *
 * 阶段 7.4g：单条 ALTER / CREATE INDEX 拆开执行，让 ALTER TABLE ADD COLUMN
 * 失败时只跳当前语句而非整批回滚。CREATE INDEX IF NOT EXISTS 自带幂等，
 * ALTER 不可逆，所以对 ALTER 失败但带 "duplicate column name" 时静默跳过。
 */

import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  id: string;
  sql: string;
}

export class MigrationRunner {
  private readonly db: DatabaseSync;
  private readonly migrations: Migration[] = [];

  constructor(db: DatabaseSync) {
    this.db = db;
    this.ensureMetaTable();
  }

  register(m: Migration): void {
    if (this.migrations.find((x) => x.id === m.id)) {
      throw new Error(`duplicate migration id: ${m.id}`);
    }
    this.migrations.push(m);
  }

  registerAll(ms: readonly Migration[]): void {
    for (const m of ms) this.register(m);
  }

  async runAll(): Promise<void> {
    const applied = new Set(this.appliedIds());
    for (const m of this.migrations) {
      if (applied.has(m.id)) continue;
      this.db.exec("BEGIN");
      try {
        for (const stmt of splitStatements(m.sql)) {
          this.execIdempotent(stmt);
        }
        this.db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
          m.id,
          new Date().toISOString(),
        );
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw new Error(`migration ${m.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * 单条语句执行：忽略"重复添加列" / "重复创建索引"（已存在）错误。
   * 其他错误继续抛 —— 由事务层回滚整批迁移。
   */
  private execIdempotent(stmt: string): void {
    try {
      this.db.exec(stmt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name/i.test(msg)) return;
      if (/already exists/i.test(msg)) return;
      throw e;
    }
  }

  private ensureMetaTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
  }

  private appliedIds(): string[] {
    const rows = this.db.prepare("SELECT id FROM schema_migrations ORDER BY id ASC").all() as { id: string }[];
    return rows.map((r) => r.id);
  }
}

/**
 * 把一段 SQL 按 `;` 切成多条独立语句。空白 / 空语句跳过。
 * 不处理字符串内的 `;` —— 我们的迁移 SQL 不含字面量。
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
