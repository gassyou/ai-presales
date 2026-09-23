/**
 * 平台探测 —— 当前 OS 与 CPU 架构
 */

export type Platform = "darwin" | "linux" | "windows" | "unknown";
export type Arch = "x86_64" | "arm64" | "x86_32" | "unknown";

export interface PlatformInfo {
  readonly platform: Platform;
  readonly arch: Arch;
  /** SQLite 扩展文件名后缀 */
  readonly extensionSuffix: "dylib" | "so" | "dll" | "unknown";
}

export function detectPlatform(): PlatformInfo {
  const os = Deno.build.os;
  const archRaw = Deno.build.arch;

  const platform: Platform =
    os === "darwin" ? "darwin" :
    os === "linux" ? "linux" :
    os === "windows" ? "windows" :
    "unknown";

  const arch: Arch =
    archRaw === "x86_64" ? "x86_64" :
    archRaw === "aarch64" ? "arm64" :
    archRaw === "x86" ? "x86_32" :
    "unknown";

  const extensionSuffix: PlatformInfo["extensionSuffix"] =
    platform === "darwin" ? "dylib" :
    platform === "linux" ? "so" :
    platform === "windows" ? "dll" :
    "unknown";

  return { platform, arch, extensionSuffix };
}