/**
 * Database 单例 + 扩展加载
 *
 * 设计：
 *   - 用 node:sqlite 的 DatabaseSync（同步 API，但本项目所有 IO 都包 async/Promise）
 *   - 启动期一次性 loadExtension + apply migrations
 *   - 暴露 execute() 给仓储用（内部 RUN），query() / queryRow() 给读用
 *   - 事务用 withTransaction(fn) 封装
 *
 * 错误：
 *   - 缺失扩展 → MissingExtensionError（含搜索路径）
 *   - schema 不匹配 → SchemaError
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "@std/path";
import type { AppPaths } from "@backend/infrastructure/platform/paths.ts";
import { MigrationRunner } from "./migrations/runner.ts";

export class MissingExtensionError extends Error {
  constructor(
    public readonly extension: string,
    public readonly searchedPaths: readonly string[],
    public readonly platform: string,
  ) {
    super(
      `SQLite extension "${extension}" not found for ${platform}. ` +
        `Searched: ${searchedPaths.join(", ")}. ` +
        `Run \`deno task fetch:extensions\` or place the file manually in <userData>/vendor/.`,
    );
    this.name = "MissingExtensionError";
  }
}

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

export interface DatabaseOptions {
  paths: AppPaths;
  /** 跳过扩展加载（单元测试用纯内存库） */
  skipExtensions?: boolean;
  /** 强制使用 :memory: 而不是 paths.data/app.db（测试用） */
  inMemory?: boolean;
  /** 测试用：注入预建 migrations */
  migrations?: readonly { id: string; sql: string }[];
}

export type QueryParam = string | number | bigint | Uint8Array | null;

export class Database {
  private readonly db: DatabaseSync;
  private _ready: Promise<void>;

  constructor(opts: DatabaseOptions) {
    const path = opts.inMemory ? ":memory:" : join(opts.paths.data, "app.db");
    this.db = new DatabaseSync(path);

    if (!opts.inMemory) {
      // WAL 模式仅对文件库有意义
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    // FK 一律打开：测试和产线行为一致；不打开会让 schema 上的 REFERENCES 形同虚设
    this.db.exec("PRAGMA foreign_keys = ON");

    this._ready = this.initialize(opts);
  }

  /** 等待初始化完成（迁移、扩展） */
  async ready(): Promise<void> {
    await this._ready;
  }

  private async initialize(opts: DatabaseOptions): Promise<void> {
    const runner = new MigrationRunner(this.db);
    if (opts.migrations) {
      runner.registerAll(opts.migrations);
    } else {
      // 默认加载内置迁移
      const { BUILTIN_MIGRATIONS } = await import("./migrations/index.ts");
      runner.registerAll(BUILTIN_MIGRATIONS);
    }
    await runner.runAll();

    if (!opts.skipExtensions && !opts.inMemory) {
      // sqlite-vector 扩展按平台加载；缺失抛 MissingExtensionError
      const { tryLoadOrWarn } = await import("./extensions/extension-loader.ts");
      await tryLoadOrWarn(this, opts.paths);
    }
  }

  // ---------- low level ----------

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly QueryParam[] = []): { changes: number; lastInsertRowid: bigint } {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: BigInt(result.lastInsertRowid ?? 0),
    };
  }

  query<T = unknown>(sql: string, params: readonly QueryParam[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  queryRow<T = unknown>(sql: string, params: readonly QueryParam[] = []): T | null {
    const rows = this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /** 事务封装 —— fn 抛错自动 ROLLBACK */
  withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}