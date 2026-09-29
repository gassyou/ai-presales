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

/**
 * POST /api/system/open-folder-dialog
 *
 * 阶段 13（PR #3）：触发桌面宿主打开原生文件夹选择器。
 *
 * 契约：
 *  - 200: { supported: true, path: string | null, cancelled: boolean }
 *  - 501: ErrorEnvelope { code: "NOT_IMPLEMENTED", ... } — 当前宿主没暴露原生 folder dialog
 *
 * 当前实现：永远返 501（host 没设 DENO_DESKTOP_FOLDER_PICKER=1）。
 * 桌面 webview 的 main.ts / dev.ts 注册了 `pickWorkspaceFolder` binding，
 * 但 Deno 桌面运行时目前没有 first-class folder picker API，binding 直接
 * 返回 cancelled 让前端 cascade 回退到 webkitdirectory + 手动文本输入。
 *
 * 未来扩展：当 Deno 运行时提供原生 folder dialog 时，只需在 main.ts / dev.ts
 * 让 binding 调用它，并 export `DENO_DESKTOP_FOLDER_PICKER=1`，本路由自动返 200。
 */
export interface OpenFolderDialogRequest {
  /** 初始打开的目录（可空）；当前实现忽略 */
  initialDir?: string | null;
}

export interface OpenFolderDialogResponse {
  supported: true;
  /** 选中路径；取消或未选择时为 null */
  path: string | null;
  cancelled: boolean;
}

export function handleOpenFolderDialog(req: Request): Response {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 当前宿主没设 DENO_DESKTOP_FOLDER_PICKER → 永远返 501
  if (Deno.env.get("DENO_DESKTOP_FOLDER_PICKER") !== "1") {
    return new Response(
      JSON.stringify({
        code: "NOT_IMPLEMENTED",
        message: "native folder dialog not available in this environment",
        traceId: "",
      }),
      {
        status: 501,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  // 占位：未来 host binding 真提供原生 dialog 时，由 binding 直接 resolve，
  // 这条 200 路径只在 host 显式 export DENO_DESKTOP_FOLDER_PICKER=1 时走。
  // 当下不会被触达，保守返 cancelled。
  const dto: OpenFolderDialogResponse = { supported: true, path: null, cancelled: true };
  return new Response(JSON.stringify(dto), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
