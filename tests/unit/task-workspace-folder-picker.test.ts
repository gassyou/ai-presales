/**
 * 任务：项目工作区「变更」+「创建文件夹」按钮 — 测试
 *
 * 验证：
 *   - 后端：POST /api/projects/:id/workspace/ensure 路由存在
 *   - 后端：project.service.ensureWorkspace 接受 opts.workspacePath 并先 setWorkspace
 *   - 后端：路由 regex 匹配 /workspace/ensure
 *   - 前端：project.api.ensureWorkspace 返回正确路径
 *   - 前端：project.store 提供 ensureWorkspace action
 *   - 前端：ProjectDetailView 替换两个按钮：
 *       "变更" → 触发隐藏的 <input type="file" webkitdirectory>
 *       "创建文件夹" → 调 store.ensureWorkspace
 *     不再调用 openWorkspaceDialog
 *   - 前端：旧的 ProjectWorkspaceDialog 不再被任何按钮引用
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("w1 — 后端 route regex 匹配 /workspace/ensure", () => {
  const route = readText("backend/presentation/routes/project.route.ts");
  assert(
    /\\\/workspace\?:\?\\\/ensure\?\?\$/.test(route) ||
      /workspace\(\?:\\\/ensure\)\?/.test(route),
    "regex 应包含 workspace(?:/ensure)?",
  );
});

Deno.test("w2 — 后端 route 有 ensureWorkspaceRoute handler", () => {
  const route = readText("backend/presentation/routes/project.route.ts");
  assertStringIncludes(route, "async function ensureWorkspaceRoute");
  assertStringIncludes(route, "deps.service.ensureWorkspace(");
});

Deno.test("w3 — service.ensureWorkspace 接受 workspacePath 参数", () => {
  const svc = readText("backend/application/project/project.service.ts");
  const m = svc.match(/async ensureWorkspace\(\s*id: ProjectId[\s\S]*?\):\s*Promise<DomainResult/);
  assert(m, "应能匹配 ensureWorkspace 签名");
  const block = m![0];
  assertStringIncludes(block, "workspacePath");
  // 实际调用 workspaceFs.mkdir(targetPath
  assert(/workspaceFs\.mkdir\(targetPath/.test(svc), "应使用 targetPath 调 mkdir");
});

Deno.test("w4 — 前端 project.api 有 ensureWorkspace", () => {
  const api = readText("frontend/src/features/project/api/project.api.ts");
  assertStringIncludes(api, "ensureWorkspace(");
  // 用 ${Endpoints.projectWorkspace(id)} 拼接 + /ensure
  assertStringIncludes(api, "projectWorkspace(id)}/ensure");
});

Deno.test("w5 — 前端 project.store 导出 ensureWorkspace action", () => {
  const store = readText("frontend/src/features/project/stores/project.store.ts");
  assertStringIncludes(store, "async function ensureWorkspace(");
  assertStringIncludes(store, "projectApi.ensureWorkspace(");
  // 在 return 对象中
  assert(/ensureWorkspace,?\s*\n\s*remove/.test(store), "ensureWorkspace 应在 return 对象中");
});

Deno.test("w6 — ProjectDetailView「变更」按钮绑 openFolderPicker", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  const codeOnly = v.replace(/<!--[\s\S]*?-->/g, "");
  // 「变更」按钮调 openFolderPicker（不再是 openWorkspaceDialog）
  assert(/<button[^>]*>\s*变更\s*<\/button>/.test(codeOnly));
  assert(/@click="openFolderPicker"/.test(codeOnly), "变更按钮应调 openFolderPicker");
  // 不再有「变更」按钮调 openWorkspaceDialog 的旧逻辑
  assert(
    !/<button[^>]*>\s*变更\s*<\/button>[\s\S]*?@click="openWorkspaceDialog"/.test(codeOnly),
    "变更按钮不应再调 openWorkspaceDialog",
  );
});

Deno.test("w7 — ProjectDetailView「创建文件夹」按钮绑 onCreateWorkspace", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  const codeOnly = v.replace(/<!--[\s\S]*?-->/g, "");
  // 「创建文件夹」按钮（label 用模板表达式，匹配 "{{ creatingWorkspace ? "创建中…" : "创建文件夹" }}")
  assert(
    /<button[^>]*>\s*\{\{\s*creatingWorkspace[\s\S]*?\}\}\s*<\/button>/.test(codeOnly),
    "应有「创建文件夹」按钮（label 在模板表达式里）",
  );
  assert(/@click="onCreateWorkspace"/.test(codeOnly), "按钮应绑 onCreateWorkspace");
});

Deno.test("w8 — ProjectDetailView 含 webkitdirectory 隐藏 input", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  assert(
    /<input[\s\S]*?type="file"[\s\S]*?webkitdirectory[\s\S]*?class="hidden"[\s\S]*?@change="onFolderPicked"/.test(
      v,
    ),
    "应有隐藏的 webkitdirectory 文件夹 input + change 绑 onFolderPicked",
  );
});

Deno.test("w9 — ProjectDetailView 含 openFolderPicker / onFolderPicked / onCreateWorkspace 函数", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  assert(/function openFolderPicker/.test(v), "应有 openFolderPicker");
  assert(/function onFolderPicked/.test(v), "应有 onFolderPicked");
  assert(/async function onCreateWorkspace/.test(v), "应有 onCreateWorkspace");
  // onCreateWorkspace 调用 store.ensureWorkspace
  const m = v.match(/async function onCreateWorkspace[\s\S]*?finally\s*\{[\s\S]*?\}/);
  assert(m, "应能匹配 onCreateWorkspace 函数");
  assertStringIncludes(m![0], "projectStore.ensureWorkspace(");
});

Deno.test("w10 — ProjectDetailView 错误回显", () => {
  const v = readText("frontend/src/features/project/ProjectDetailView.vue");
  assert(/<p v-if="workspaceError"/.test(v), "应有 workspaceError 文案展示");
});