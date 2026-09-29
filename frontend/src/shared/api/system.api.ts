/**
 * system.api.ts —— 跨平台元信息
 *
 * 阶段 13（PR #2）：前端需要按 OS 区分 workspace 默认路径：
 *   - macOS / Linux:   ${HOME}/Desktop/<code>
 *   - Windows:         ${USERPROFILE}\Desktop\<code>
 *
 * 阶段 13（PR #3）：触发桌面宿主打开原生 folder dialog。
 *   - 当前 Deno 桌面运行时无 first-class folder picker，调用始终抛 ApiError(501)
 *   - 前端 cascade 到 webkitdirectory / 手动输入
 *   - 未来 host 暴露原生 dialog 时，前端契约不变
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
   * 当前宿主不支持 → 抛 ApiError(501)；调用方用 try/catch 走下一级。
   */
  async openFolderDialog(initialDir?: string | null): Promise<OpenFolderDialogResponse> {
    return await http.post<OpenFolderDialogResponse>(Endpoints.systemOpenFolderDialog, {
      initialDir: initialDir ?? null,
    });
  },
};
