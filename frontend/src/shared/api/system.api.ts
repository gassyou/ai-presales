/**
 * system.api.ts —— 跨平台元信息
 *
 * 阶段 13（PR #2）：前端需要按 OS 区分 workspace 默认路径：
 *   - macOS / Linux:   ${HOME}/Desktop/<code>
 *   - Windows:         ${USERPROFILE}\Desktop\<code>
 *
 * 阶段 13（PR #3）：触发桌面宿主打开原生 folder dialog。
 *   - 桌面后端调用操作系统原生目录选择器，返回绝对路径
 *   - 前端在无法使用原生对话框时回退到 webkitdirectory / 手动输入
 */

import { Endpoints } from "@frontend/shared/api/endpoints.ts";

export type PlatformName = "darwin" | "linux" | "windows" | "unknown";
export type PathSeparator = "/" | "\\";

export interface PlatformInfoDTO {
  platform: PlatformName;
  home: string;
  sep: PathSeparator;
}

/**
 * 阶段 13（PR #3）：openFolderDialog 200 响应。
 *   supported=true 且 path 非空 → 前端直接使用；
 *   cancelled=true / path=null → 前端 cascade 到下一级。
 */
export interface OpenFolderDialogResponse {
  supported: true;
  path: string | null;
  cancelled: boolean;
}

import { http } from "@frontend/shared/api/http-client.ts";

export const systemApi = {
  async getPlatform(): Promise<PlatformInfoDTO> {
    return await http.get<PlatformInfoDTO>(Endpoints.systemPlatform);
  },
  /**
   * 阶段 13（PR #3）：请桌面宿主打开原生 folder dialog。
   * 对话框取消时返回 { path: null, cancelled: true }；调用方走下一级。
   */
  async openFolderDialog(initialDir?: string | null): Promise<OpenFolderDialogResponse> {
    return await http.post<OpenFolderDialogResponse>(Endpoints.systemOpenFolderDialog, {
      initialDir: initialDir ?? null,
    });
  },
};
