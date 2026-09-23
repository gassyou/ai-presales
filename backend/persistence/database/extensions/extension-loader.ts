/**
 * sqlite-vector 扩展加载
 *
 * 平台 + arch → 在 <userData>/vendor/ 下找 .dylib / .so / .dll
 * 缺失抛 MissingExtensionError（不静默降级）。
 *
 * 加载：
 *   node:sqlite 的 DatabaseSync 自带 loadExtension(path) 与 enableLoadExtension(true)。
 *   enableLoadExtension 默认 false，需要先打开。
 *
 * 阶段 2 验收：
 *   - 找不到扩展 → MissingExtensionError，错误信息列出搜索路径 + 修复指引
 *   - 找到了 → 加载成功，可用 PRAGMA 或 vector_init() 验证
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import type { Database } from "../database.ts";
import { MissingExtensionError } from "../database.ts";
import type { AppPaths } from "@backend/infrastructure/platform/paths.ts";
import { detectPlatform } from "@backend/infrastructure/platform/platform-info.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

const EXTENSION_NAME = "vector";

function expectedFilename(): string {
  const { extensionSuffix } = detectPlatform();
  if (extensionSuffix === "unknown") {
    throw new MissingExtensionError(EXTENSION_NAME, [], "unknown");
  }
  return `${EXTENSION_NAME}.${extensionSuffix}`;
}

export interface LoadResult {
  /** 是否真的加载了扩展 */
  loaded: boolean;
  searchedPaths: readonly string[];
}

/**
 * 尝试加载 sqlite-vector。失败抛 MissingExtensionError。
 * 调用方负责决定要不要 catch + 降级（阶段 2 内向量检索未启用，可以 warn 并继续）。
 */
export async function loadSqliteVector(db: Database, paths: AppPaths): Promise<LoadResult> {
  const { platform } = detectPlatform();
  const target = expectedFilename();
  const searched: string[] = [
    join(paths.vendor, target),
    join(paths.vendor, "sqlite-vector", target),
  ];
  for (const c of searched) {
    if (await exists(c)) {
      try {
        db.exec(`SELECT load_extension('${escapePath(c)}')`);
        return { loaded: true, searchedPaths: searched };
      } catch (e) {
        throw new MissingExtensionError(
          EXTENSION_NAME,
          searched,
          `${platform}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return { loaded: false, searchedPaths: searched };
}

/** 静默缺失（warn + 返回 false），给"扩展不在也能跑主库"的能力 */
export async function tryLoadOrWarn(db: Database, paths: AppPaths, logger?: Logger): Promise<boolean> {
  try {
    const r = await loadSqliteVector(db, paths);
    if (!r.loaded && logger) {
      logger.warn("sqlite-vector extension not found; vector features disabled", {
        searched: r.searchedPaths,
        hint: "run `deno task fetch:extensions` or place the file in <userData>/vendor/",
      });
    } else if (r.loaded && logger) {
      logger.info("sqlite-vector extension loaded", { path: r.searchedPaths[0] });
    }
    return r.loaded;
  } catch (e) {
    if (e instanceof MissingExtensionError) {
      logger?.error("sqlite-vector extension failed to load", { message: e.message });
      return false;
    }
    throw e;
  }
}

/** SQL 字符串里嵌入文件路径 —— 简单替换单引号；用户 dataDir 不应含引号但防御一下 */
function escapePath(p: string): string {
  return p.replace(/'/g, "''");
}