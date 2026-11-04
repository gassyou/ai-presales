/**
 * 应用入口（同时支持浏览器调试 + deno desktop 双模式）
 *
 * 关键差异：
 *   - 在 `deno desktop` 下，端口由 desktop 运行时自动选择并通过
 *     `DENO_SERVE_ADDRESS`（形如 `tcp:127.0.0.1:<port>`）注入；用户传的 port 会被忽略。
 *     此时没有 webview 自启动，需主动 `new Deno.BrowserWindow()` + `navigate(...)`。
 *   - 在 `deno run -A main.ts` 下，用内存默认端口（或 AI_PRESALES_CONFIG 指向的 TOML 里的 port）起 server；浏览器调试。
 *
 * 自动识别：通过 `DENO_SERVE_ADDRESS` 是否存在判断。
 *
 * 依赖装配在 backend/bootstrap/runtime.ts —— dev.ts 用的是同一份，
 * 两边不可能再装配出两套不同的 app（之前 dev.ts 手抄了一份，少挂了 9 个依赖，
 * 导致 dev 模式下 chat session / 附件 / dashboard / settings / skill 全是 501）。
 */

import { dirname, join } from "@std/path";
import { buildRuntime } from "@backend/bootstrap/runtime.ts";
import { openDesktopWindow } from "@backend/bootstrap/desktop.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

/**
 * 阶段 7.6（macOS 编译版启动修复）：dist 查找顺序
 *   1. cwd/dist（开发态 `deno task start` 或用户在 dist 同级启动）
 *   2. 可执行文件同级的 dist（编译产物 + 同目录 dist/ 的标准发行方式）
 *   3. cwd/dist 仍作 fallback，static handler 在缺文件时返 404
 *
 * 重要：编译后的产物若 dist/ 与可执行文件不在同一目录，必须用 cwd 启动。
 */
function resolveDistRoot(): string {
  const cwd = Deno.cwd();
  // 0. cwd 本身直接就是 dist（用户 `cd dist` 后启动 binary）——直接用 cwd
  if (looksLikeDistRoot(cwd)) return cwd;

  // 1. cwd/dist（开发态 `deno task start` 或用户在 dist 同级启动）
  const cwdDist = join(cwd, "dist");
  if (looksLikeDistRoot(cwdDist)) return cwdDist;

  // 2. 可执行文件同级 dist（用户在 dist 目录里直接启动 binary；或 binary 与 dist 平级）
  try {
    const exeDir = dirname(Deno.execPath());
    const exeDist = join(exeDir, "dist");
    if (looksLikeDistRoot(exeDist)) return exeDist;
    if (looksLikeDistRoot(exeDir)) return exeDir;

    // 2.5 .app bundle 自包含：execPath = .../Foo.app/Contents/MacOS/<bin>
    //     前端 dist 已被打包进 .../Contents/Resources/dist
    const resourcesDir = join(exeDir, "..", "Resources");
    const resourcesDist = join(resourcesDir, "dist");
    if (looksLikeDistRoot(resourcesDist)) return resourcesDist;

    // 2.6 兼容旧包结构：execPath = .../Foo.app/Contents/MacOS/dist/<bin>
    //     这种情况下 dist 与 binary 平级，exeDist 已在上方覆盖
  } catch (_) { /* not found */ }
  // 最终回退：cwd/dist（即便不存在也返回，静态服务会兜底）
  return cwdDist;
}

/** 判断路径是否就是"dist 根"——含 index.html */
function looksLikeDistRoot(p: string): boolean {
  try {
    const s = Deno.statSync(p);
    if (!s.isDirectory) return false;
    // 含 index.html 就是 dist 根
    Deno.statSync(join(p, "index.html"));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 阶段 7.6：启动期把 dist 目录内容列出来，便于排查"dist 不全"问题
 */
function debugDistContents(root: string, log: Logger): void {
  try {
    const entries = [...Deno.readDirSync(root)];
    log.info(
      `dist contents (${root}): [${
        entries.map((e) => e.name + (e.isDirectory ? "/" : "")).sort().join(", ")
      }]`,
    );
  } catch (e) {
    log.error(`cannot read dist ${root}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const distRoot = resolveDistRoot();

const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;

const { app, config, logger } = await buildRuntime({
  devMode: false,
  staticRoot: distRoot,
  logContext: "main",
});

const server = isDesktopMode
  // desktop 模式：不传 options，让 Deno.serve 读 DENO_SERVE_ADDRESS
  ? Deno.serve(app.fetch)
  : Deno.serve(
    {
      hostname: config.server.host,
      port: config.server.port,
      onListen: ({ hostname, port }: { hostname: string; port: number }) => {
        logger.info(`listening on http://${hostname}:${port}`);
        logger.info(`serving frontend from ${distRoot}`);
        logger.info(`open http://localhost:${port}/ in your browser`);
        debugDistContents(distRoot, logger);
        // 阶段 7.6（macOS 编译版启动修复）：dist 不存在时给清晰提示
        try {
          Deno.statSync(`${distRoot}/index.html`);
        } catch {
          logger.warn(`${distRoot}/index.html 不存在！`);
          logger.warn(`   请把前端构建产物（dist/index.html + dist/assets/）放到该目录下，`);
          logger.warn(`   或者把可执行文件移动到与 dist/ 同一目录再启动。`);
          logger.warn(`   现在请求根路径会返 404。`);
        }
      },
    },
    app.fetch,
  );

// 仅 desktop 模式需要 BrowserWindow
if (isDesktopMode) {
  openDesktopWindow({ title: "端点星", logger });
}

await server.finished;
