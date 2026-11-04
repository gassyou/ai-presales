/**
 * 开发入口
 *
 * - 装配与生产入口完全同一份（backend/bootstrap/runtime.ts），只是 devMode=true、
 *   不托管静态资源（前端跑在 vite dev 5173）。
 * - 之前这里手抄了一份 createApp({...})，少挂了 9 个依赖 —— dev 模式下
 *   chat session / 附件 / dashboard / settings / skill 全是 501，prod 却正常，
 *   漂移只在使用频率最高的开发态显形。现在装配只有一份，漂移无处藏身。
 *
 * 用法：deno task dev（= deno run -A --watch dev.ts）
 */

import { buildRuntime } from "@backend/bootstrap/runtime.ts";
import { openDesktopWindow } from "@backend/bootstrap/desktop.ts";

const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;

const { app, config, logger } = await buildRuntime({
  devMode: true, // 允许 vite 跨域
  staticRoot: undefined, // dev 不托管静态资源
  logContext: "dev",
});

const server = isDesktopMode ? Deno.serve(app.fetch) : Deno.serve(
  {
    hostname: config.server.host,
    port: config.server.port,
    onListen: ({ hostname, port }: { hostname: string; port: number }) => {
      logger.info(`listening on http://${hostname}:${port}`);
      logger.info(
        `vite dev expected at http://${hostname}:5173 (run 'deno task dev:frontend' in another terminal)`,
      );
      logger.info(`health: curl http://${hostname}:${port}/api/health`);
    },
  },
  app.fetch,
);

if (isDesktopMode) {
  openDesktopWindow({ title: "AI 提案协助 (dev)", logger });
  logger.info("前端开发请另起一个终端跑: deno task dev:frontend");
}

await server.finished;
