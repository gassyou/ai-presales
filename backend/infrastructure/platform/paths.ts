/**
 * 路径解析 —— userData / data / logs / vendor
 *
 * macOS:   ~/Library/Application Support/ai-presales/
 * Windows: %APPDATA%/ai-presales/
 * Linux:   ~/.local/share/ai-presales/
 *
 * 开发态可通过 APP_DATA_DIR 环境变量覆盖。
 */

import { join } from "@std/path";
import { detectPlatform } from "./platform-info.ts";

export function defaultDataDir(): string {
  const override = Deno.env.get("APP_DATA_DIR");
  if (override && override.trim().length > 0) return override;

  const { platform } = detectPlatform();
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";

  switch (platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "ai-presales");
    case "windows":
      return join(home, "AppData", "Roaming", "ai-presales");
    case "linux":
      return join(home, ".local", "share", "ai-presales");
    default:
      return join(Deno.cwd(), ".data");
  }
}

/** 展开 ${VAR} 占位符；若变量未设则保留原文本（由调用方决定回退策略） */
export function interpolateEnv(value: string, fallback?: () => string): string {
  return value.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    const v = Deno.env.get(name);
    if (v !== undefined && v !== "") return v;
    return fallback ? fallback() : match;
  });
}

export interface AppPaths {
  /** 应用根目录 */
  root: string;
  /** SQLite 数据库 */
  data: string;
  /** 日志 */
  logs: string;
  /** SQLite 扩展（sqlite-vec 等） */
  vendor: string;
  /** 输出文件默认目录 */
  output: string;
}

export function resolvePaths(): AppPaths {
  const root = defaultDataDir();
  return {
    root,
    data: join(root, "data"),
    logs: join(root, "logs"),
    vendor: join(root, "vendor"),
    output: join(root, "output"),
  };
}

/** 展开 ~/ 前缀 */
export function expandHome(path: string): string {
  if (!path.startsWith("~/")) return path;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  return home + path.slice(1);
}

/** 确保目录存在（递归） */
export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  }
}