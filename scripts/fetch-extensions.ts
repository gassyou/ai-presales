/**
 * 按平台拉取 SQLite 扩展（sqlite-vec）
 *
 * 使用方式：
 *   deno task fetch:extensions
 *
 * 阶段 2 接入。阶段 1 占位，先确保脚本能跑起来。
 */

import { detectPlatform } from "@backend/infrastructure/platform/platform-info.ts";
import { resolvePaths, ensureDir } from "@backend/infrastructure/platform/paths.ts";

const RELEASES = {
  vec: "https://github.com/sqliteai/sqlite-vector/releases",
} as const;

async function main(): Promise<void> {
  const platform = detectPlatform();
  const paths = resolvePaths();

  if (platform.extensionSuffix === "unknown") {
    console.error("无法识别当前平台，无法下载扩展");
    Deno.exit(1);
  }

  await ensureDir(paths.vendor);

  console.log("平台:", platform.platform, "/", platform.arch);
  console.log("扩展后缀:", platform.extensionSuffix);
  console.log("目标目录:", paths.vendor);
  console.log();
  console.log("[阶段 1 占位] 此脚本将在阶段 2 接入。");
  console.log();
  console.log("预期下载:");
  console.log(`  - vec0.${platform.extensionSuffix}  from ${RELEASES.vec}`);
  console.log();
  console.log("手动放置方式（如自动下载失败）:");
  console.log(`  把 vec0.${platform.extensionSuffix} 放入 ${paths.vendor}/`);
}

if (import.meta.main) {
  await main();
}