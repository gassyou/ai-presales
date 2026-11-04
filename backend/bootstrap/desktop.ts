/**
 * desktop 模式（Deno.BrowserWindow）—— main.ts 与 dev.ts 共用。
 *
 * 为什么共用：两个入口都要开窗口、都要注册 pickWorkspaceFolder binding，
 * 之前各写一份，改一处忘另一处就是 webview 里"选不了文件夹"。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export interface DesktopWindowOptions {
  /** 窗口标题 */
  readonly title: string;
  readonly logger: Logger;
}

/**
 * 打开 desktop 窗口并注册 host-side binding。
 *
 * 非 desktop 模式（没有 DENO_SERVE_ADDRESS）直接返回 —— 调用方可以无条件调用。
 */
export function openDesktopWindow(options: DesktopWindowOptions): void {
  const port = Deno.env.get("DENO_SERVE_ADDRESS")?.split(":").pop();
  if (!port) return;

  // Deno.BrowserWindow 由 desktop 运行时注入；ambient 类型见 shared/types/deno-desktop.d.ts
  const BrowserWindow = (Deno as unknown as {
    BrowserWindow: new (opts?: unknown) => {
      navigate(url: string): void;
      bind?: (name: string, fn: (...args: unknown[]) => unknown) => void;
    };
  }).BrowserWindow;
  const win = new BrowserWindow({
    title: options.title,
    width: 1280,
    height: 800,
  });
  win.navigate(`http://127.0.0.1:${port}/`);
  // 阶段 13（PR #3）：注册 host-side binding `pickWorkspaceFolder`，给 webview
  // 调用以打开原生 folder dialog。当前 Deno 桌面运行时尚无 first-class folder
  // picker API，binding 直接返 cancelled 让前端 cascade 到 webkitdirectory + 手动输入。
  // 未来运行时暴露原生 folder dialog 时，把这个 callback 换成实际弹窗逻辑即可。
  if (typeof win.bind === "function") {
    (win as unknown as {
      bind: (name: string, fn: (...args: unknown[]) => unknown) => void;
    }).bind("pickWorkspaceFolder", async (_initialDir: unknown) => {
      return { path: null, cancelled: true };
    });
  }
  options.logger.info(`desktop window opened on http://127.0.0.1:${port}/`);
}
