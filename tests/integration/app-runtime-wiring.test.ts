/**
 * 装配唯一来源 —— 行为测试
 *
 * 背景：dev.ts 曾经手抄了一份不完整的 createApp({...})，少挂 9 个依赖。
 * server.ts 里每个路由都有"没注入就返 501"的分支，于是 dev 模式下
 * 前端真正在用的接口（chat session / 附件 / dashboard / settings / skill）
 * 全部 501，而 prod 正常 —— 漂移只在使用频率最高的开发态显形。
 *
 * 这里直接装配一次 app，逐个打这些端点，断言不再是 501。
 * 装配只用 devMode=true（dev 模式的开关），staticRoot 不传 —— 与 dev.ts 一致。
 */

import { assert } from "@std/assert";
import { buildRuntime } from "@backend/bootstrap/runtime.ts";

/** 这些路径以前在 dev 模式下一律 501（路由依赖没注入） */
const FORMERLY_501 = [
  "/api/dashboard/summary",
  "/api/settings",
  "/api/chat/sessions",
  "/api/chat/sessions/00000000-0000-4000-8000-000000000000/attachments",
  "/api/skills",
  "/api/ai/auto-mode",
];

Deno.test("runtime — dev 模式（devMode=true）下这些接口不再是 501", async () => {
  // 装到临时目录，不碰真实数据目录
  const tmp = await Deno.makeTempDir({ prefix: "ai-runtime-" });
  Deno.env.set("APP_DATA_DIR", tmp);

  const { app } = await buildRuntime({
    devMode: true,
    staticRoot: undefined,
    logContext: "test",
  });

  for (const path of FORMERLY_501) {
    const res = await app.fetch(new Request(`http://localhost${path}`));
    assert(
      res.status !== 501,
      `${path} 不该返回 501（实际 ${res.status}）—— 装配漏了这个路由依赖`,
    );
  }
});

Deno.test("runtime — 同一份装配换 devMode=false 也一样可用（prod 侧没被改坏）", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "ai-runtime-prod-" });
  Deno.env.set("APP_DATA_DIR", tmp);

  const { app } = await buildRuntime({
    devMode: false,
    staticRoot: undefined,
    logContext: "test",
  });

  for (const path of FORMERLY_501) {
    const res = await app.fetch(new Request(`http://localhost${path}`));
    assert(res.status !== 501, `${path} 不该返回 501（实际 ${res.status}）`);
  }
});
