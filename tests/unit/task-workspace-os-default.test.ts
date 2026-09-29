/**
 * 任务：workspace 默认路径按 OS 区分（mac/win/linux）—— 测试
 *
 * 验证：
 *   - 后端 domain computeDefaultWorkspacePath 按 Deno.build.os 区分分隔符
 *   - 后端新增 /api/system/platform 端点（mac/linux/win）
 *   - 前端 Endpoints.systemPlatform 存在
 *   - 前端 systemApi + PlatformInfoDTO 类型
 *   - 前端 ProjectDetailView 用 defaultWorkspaceHint（按平台）替代硬编码 ~/Desktop/
 *   - 前端 ProjectWorkspaceDialog defaultHint 按平台
 */

import { assert, assertStringIncludes, assertEquals } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("os1 — 后端 Project.computeDefaultWorkspacePath 按 Deno.build.os 区分", () => {
  const src = readText("backend/domain/project/project.ts");
  // 捕获 computeDefaultWorkspacePath 函数体
  const m = src.match(
    /computeDefaultWorkspacePath\(homeDir\?: string\): string\s*\{[\s\S]*?\n  \}/,
  );
  assert(m, "应能匹配 computeDefaultWorkspacePath 函数体");
  const body = m![0];
  // 用 Deno.build.os 区分平台
  assertStringIncludes(body, "Deno.build.os");
  // 用不同的 sep (TS string literal 中 "\\\\" 表示单 \；用更松匹配)
  assert(/sep = platform === "windows" \?/.test(body), "sep 应按 platform 切换");
  // win 路径用反斜杠拼 Desktop
  assert(/sep\}Desktop/.test(body),
    "拼接应使用 sep\\Desktop\\{sep}");
});

Deno.test("os2 — 后端 /api/system/platform 端点存在", () => {
  const route = readText("backend/presentation/routes/system.route.ts");
  assertStringIncludes(route, "GET /api/system/platform");
  assertStringIncludes(route, "export function handleSystemPlatform");
  assertStringIncludes(route, "Deno.build.os");
  assertStringIncludes(route, "USERPROFILE");
  assertStringIncludes(route, "HOME");
  // 跨平台 sep 决策
  assert(/p\.platform === "windows" \? "\\\\"/.test(route), "sep 应按 platform 切换");
});

Deno.test("os3 — server.ts 注册 /api/system/platform 路由", () => {
  const server = readText("backend/presentation/server.ts");
  assertStringIncludes(server, "handleSystemPlatform");
  assertStringIncludes(
    server,
    'if (path === "/api/system/platform")',
  );
});

Deno.test("os4 — 前端 Endpoints.systemPlatform 存在", () => {
  const ep = readText("frontend/src/shared/api/endpoints.ts");
  assertStringIncludes(ep, "systemPlatform:");
  assertStringIncludes(ep, "/api/system/platform");
});

Deno.test("os5 — 前端 system.api.ts 含 PlatformInfoDTO + getPlatform", () => {
  const api = readText("frontend/src/shared/api/system.api.ts");
  assertStringIncludes(api, "interface PlatformInfoDTO");
  assertStringIncludes(api, "platform: PlatformName");
  assertStringIncludes(api, "home: string");
  assertStringIncludes(api, "sep: PathSeparator");
  assertStringIncludes(api, "async getPlatform()");
  assertStringIncludes(api, "Endpoints.systemPlatform");
});

Deno.test("os6 — ProjectDetailView 用 defaultWorkspaceHint 替代硬编码", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  const codeOnly = v.replace(/<!--[\s\S]*?-->/g, "");
  // 不再有 ~/Desktop/{{ project.name }} 硬编码
  assert(
    !/~\/Desktop\/\{\{\s*project\.name\s*\}\}/.test(codeOnly),
    "不应再有 ~/Desktop/{{ project.name }} 硬编码",
  );
  // 改用 defaultWorkspaceHint
  assert(/v-else[^>]*>\s*\{\{\s*defaultWorkspaceHint\s*\}\}/.test(codeOnly));
  // computed 含按平台分支
  const m = v.match(/const defaultWorkspaceHint = computed[\s\S]*?\}\)/);
  assert(m, "应能匹配 defaultWorkspaceHint computed");
  const body = m![0];
  assertStringIncludes(body, "platformInfo.value");
  assertStringIncludes(body, '"darwin"');
  assertStringIncludes(body, '"windows"');
  assertStringIncludes(body, '"linux"');
  // onMounted 触发 loadPlatformInfo
  assert(/void loadPlatformInfo\(\)/.test(v));
});

Deno.test("os7 — ProjectWorkspaceDialog defaultHint 按平台", () => {
  const v = readText(
    "frontend/src/features/project/components/ProjectWorkspaceDialog.vue",
  );
  // 不再有硬编码字符串 `~/Desktop/<code>`（旧版用 template literal 立刻返回）
  assert(
    !/computed\(\(\) => `~\/Desktop\/\$\{props\.project\.code\}`\)/.test(v),
    "不应再有 hard-coded `~/Desktop/${code}` 立刻返回",
  );
  // 改为按 platformInfo 拼接
  const m = v.match(/const defaultHint = computed<string>\(\(\) =>\s*\{[\s\S]*?\}\);/);
  assert(m, "应能匹配 defaultHint computed（带函数体）");
  const body = m![0];
  assertStringIncludes(body, "platformInfo.value");
  // 局部变量 sep 来自 p?.sep
  assertStringIncludes(body, "p?.sep");
  assertStringIncludes(body, "p.home");
  assertStringIncludes(body, "props.project.code");
  assertStringIncludes(body, "${sep}Desktop${sep}");
});