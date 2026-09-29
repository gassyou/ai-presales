/**
 * system.route.ts —— 系统元信息（平台 + 用户主目录）端点
 *
 * 阶段 13（PR #2）：前端需要按 OS 区分 workspace 默认路径。
 *   - macOS / Linux:   ${HOME}/Desktop/<code>
 *   - Windows:         ${USERPROFILE}\Desktop\<code>
 *   - 服务器未知主目录时降级为空字符串，由前端 fallback。
 */

import { detectPlatform, type Platform } from "@backend/infrastructure/platform/platform-info.ts";

interface PlatformInfoDTO {
  /** "darwin" | "linux" | "windows" | "unknown" */
  platform: Platform;
  /** 用户主目录绝对路径。空字符串 = 后端拿不到（容器/CI）。 */
  home: string;
  /** 路径分隔符："/" 或 "\\" */
  sep: "/" | "\\";
}

function resolveHome(): string {
  const platform = Deno.build.os;
  if (platform === "windows") {
    return Deno.env.get("USERPROFILE") ??
      Deno.env.get("HOME") ??
      "C:\\Users\\Default";
  }
  return Deno.env.get("HOME") ?? "/tmp";
}

/**
 * GET /api/system/platform
 * 跨平台元信息，用于前端组装 workspace 默认路径。
 */
export function handleSystemPlatform(_req: Request): Response {
  const p = detectPlatform();
  const home = resolveHome();
  const sep: PlatformInfoDTO["sep"] = p.platform === "windows" ? "\\" : "/";
  const dto: PlatformInfoDTO = {
    platform: p.platform,
    home,
    sep,
  };
  return new Response(JSON.stringify(dto), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}