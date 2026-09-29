/**
 * system.api.ts —— 跨平台元信息
 *
 * 阶段 13（PR #2）：前端需要按 OS 区分 workspace 默认路径：
 *   - macOS / Linux:   ${HOME}/Desktop/<code>
 *   - Windows:         ${USERPROFILE}\Desktop\<code>
 */

import { Endpoints } from "@frontend/shared/api/endpoints.ts";

export type PlatformName = "darwin" | "linux" | "windows" | "unknown";
export type PathSeparator = "/" | "\\";

export interface PlatformInfoDTO {
  platform: PlatformName;
  home: string;
  sep: PathSeparator;
}

import { http } from "@frontend/shared/api/http-client.ts";

export const systemApi = {
  async getPlatform(): Promise<PlatformInfoDTO> {
    return http.get<PlatformInfoDTO>(Endpoints.systemPlatform);
  },
};