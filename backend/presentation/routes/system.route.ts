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
 * `webkitdirectory` 选择的 File 对象在大多数 WebView 中不会暴露绝对路径，
 * 因而不能用它保存工作区。本端点由桌面后端调用操作系统文件夹对话框，直接
 * 把选中的绝对路径返回给前端。
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

export async function handleOpenFolderDialog(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let path: string | null = null;
  try {
    const command = folderDialogCommand();
    const result = await command.output();
    // 用户取消时 macOS 的 osascript / Windows PowerShell 都会返回非 0；
    // 它不是错误，前端会保持当前路径。
    if (result.success) {
      const selected = new TextDecoder().decode(result.stdout).trim();
      path = selected || null;
    }
  } catch {
    // 例如 Linux 缺少 zenity。保留前端的 web/manual 回退，避免“变更”按钮失效。
  }

  const dto: OpenFolderDialogResponse = {
    supported: true,
    path,
    cancelled: path === null,
  };
  return new Response(JSON.stringify(dto), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** 以固定参数调用各平台的系统目录选择器；不拼接用户输入到脚本。 */
function folderDialogCommand(): Deno.Command {
  switch (Deno.build.os) {
    case "darwin":
      return new Deno.Command("osascript", {
        args: ["-e", 'POSIX path of (choose folder with prompt "选择项目工作区")'],
      });
    case "windows":
      return new Deno.Command("powershell.exe", {
        args: [
          "-NoProfile",
          "-STA",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '选择项目工作区'; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }",
        ],
      });
    default:
      return new Deno.Command("zenity", {
        args: ["--file-selection", "--directory", "--title=选择项目工作区"],
      });
  }
}
