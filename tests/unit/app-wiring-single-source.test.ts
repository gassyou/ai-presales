/**
 * 装配唯一来源 —— 静态断言
 *
 * 背景：main.ts（生产 / 桌面）与 dev.ts（开发）曾经各手写一份 createApp({...})
 * 装配清单。dev.ts 那份是手抄的，少挂了 9 个依赖（chat session / 附件 /
 * dashboard / settings / skill / auto-mode / profileSnapshot /
 * invokeSubAgentUseCase），于是 dev 模式下这些接口一律 501，prod 却一直正常 ——
 * 漂移只在使用频率最高的开发态显形，而且没人会发现。
 *
 * 修法不是"把缺的补上"（补完下次加路由还会漂），而是让装配只有一份：
 * backend/bootstrap/runtime.ts 里的 buildRuntime()，两个入口都调它。
 *
 * 这里钉住三件事：
 *   1. createApp({...}) 在整个后端只出现一次（装配只有一份）
 *   2. main.ts / dev.ts 都通过 buildRuntime 拿 app，不再自己拼 deps
 *   3. 那唯一一份装配里，所有"不注入就 501"的路由依赖都在
 */

import { assert, assertStringIncludes } from "@std/assert";
import { functionBody, readText } from "../helpers/read-source.ts";

const RUNTIME = "backend/bootstrap/runtime.ts";

/** 递归列出 backend/ 下的 .ts 文件 + 两个入口 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of Deno.readDirSync(rel)) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory) {
        walk(child);
      } else if (entry.name.endsWith(".ts")) {
        out.push(child);
      }
    }
  };
  walk("backend");
  out.push("main.ts", "dev.ts");
  return out;
}

/** 去掉注释 —— 注释里提到 createApp( 不算真调用 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

Deno.test("wiring — createApp({...}) 在后端只出现一次（装配只有一份）", () => {
  const hits: string[] = [];
  for (const f of sourceFiles()) {
    const src = stripComments(readText(f));
    if (src.includes("createApp({")) hits.push(f);
  }
  assertEqualsSet(hits, [RUNTIME], "createApp 只能在一处被调用 —— 装配清单不能有两份");
});

function assertEqualsSet(
  actual: readonly string[],
  expected: readonly string[],
  msg: string,
): void {
  assert(
    actual.length === expected.length && expected.every((e) => actual.includes(e)),
    `${msg}（实际：${actual.join(", ") || "无"}）`,
  );
}

Deno.test("wiring — main.ts / dev.ts 都通过 buildRuntime 拿 app", () => {
  for (const f of ["main.ts", "dev.ts"]) {
    const src = readText(f);
    assertStringIncludes(src, 'from "@backend/bootstrap/runtime.ts"');
    assertStringIncludes(src, "await buildRuntime({");
    // 入口不再自己拼 createApp 的依赖清单
    assert(
      !stripComments(src).includes("createApp("),
      `${f} 不该自己调 createApp —— 装配只在 runtime.ts`,
    );
  }
});

Deno.test("wiring — 两个入口只差 devMode / staticRoot / 日志组件名", () => {
  const mainSrc = readText("main.ts");
  const devSrc = readText("dev.ts");
  assertStringIncludes(mainSrc, "devMode: false,");
  assertStringIncludes(mainSrc, "staticRoot: distRoot,");
  assertStringIncludes(devSrc, "devMode: true,");
  assertStringIncludes(devSrc, "staticRoot: undefined,");
});

Deno.test("wiring — 唯一那份装配里，所有不注入就 501 的路由依赖都在", () => {
  const src = readText(RUNTIME);
  const body = functionBody(src, "export async function buildRuntime(");
  for (
    const dep of [
      "dashboardRoute:",
      "settingsRoute:",
      "chatSessionRoute:",
      "chatAttachmentRoute:",
      "skillRoute:",
      "autoModeRoute:",
    ]
  ) {
    assertStringIncludes(body, dep);
  }
  // 阶段 13（PR #7）：dev 之前也没挂 smtpFactory —— 发信直接失败
  assertStringIncludes(body, "smtpFactory: createSmtpTransport");
});
