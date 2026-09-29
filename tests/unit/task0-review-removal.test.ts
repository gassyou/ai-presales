/**
 * 任务 0：取消"方案 review"模块 + 删除菜单项 —— 测试
 *
 * 验证：
 *   1. ProjectDetailView.vue 的 ModuleKey 类型已不含 "review"
 *   2. ProjectDetailView.vue 的 navGroups 已不含 "方案 Review" 菜单项
 *   3. ProjectDetailView.vue 不再 import ReviewView 组件
 *   4. ReviewView.vue 文件已删除
 *   5. 后端 review 路由 + domain + use case + tests 仍保留（向后兼容，迁移安全）
 *
 * 用静态文本扫描而不是渲染组件，因为项目无 vue 测试基础设施。
 */

import { assert, assertStringIncludes } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

// 测试根：deno test 在仓库根执行，CWD 即仓库根
const projectRoot = Deno.cwd();

function readText(rel: string): string {
  return Deno.readTextFileSync(join(projectRoot, rel));
}

function fileExists(rel: string): boolean {
  return existsSync(join(projectRoot, rel));
}

Deno.test("task0 — ProjectDetailView ModuleKey 不再含 'review'", () => {
  const src = readText("frontend/src/features/project/ProjectDetailView.vue");
  // 模块元数据类型——检查 union 中不再有 "review"
  // 用正则断言 union 内不包含 "review"
  const moduleKeyBlock = src.match(/type ModuleKey[\s\S]*?;/);
  assert(moduleKeyBlock, "ModuleKey 类型声明必须存在");
  assert(
    !moduleKeyBlock[0].includes('| "review"'),
    "ModuleKey 不应再含 'review'，已取消",
  );
});

Deno.test("task0 — ProjectDetailView 菜单不含 '方案 Review'", () => {
  const src = readText("frontend/src/features/project/ProjectDetailView.vue");
  // 只检查 navGroups 数组内的菜单项；注释里的旧字串保留无害
  const navGroupsBlock = src.match(/const navGroups:[\s\S]*?\];/);
  assert(navGroupsBlock, "navGroups 数组必须存在");
  assert(
    !navGroupsBlock[0].includes("方案 Review"),
    "navGroups 不应再有 '方案 Review' 菜单项",
  );
  assert(
    !navGroupsBlock[0].includes('key: "review"'),
    "navGroups 不应再有 key='review' 菜单项",
  );
});

Deno.test("task0 — ProjectDetailView 不再 import ReviewView", () => {
  const src = readText("frontend/src/features/project/ProjectDetailView.vue");
  assert(
    !src.includes("import ReviewView"),
    "ProjectDetailView 不应再 import ReviewView",
  );
  assert(
    !src.includes('case "review":'),
    "组件派发 switch 不应再有 case 'review'",
  );
});

Deno.test("task0 — ReviewView.vue 文件已删除", () => {
  assert(
    !fileExists("frontend/src/features/business-module/components/ReviewView.vue"),
    "ReviewView.vue 应已删除",
  );
});

Deno.test("task0 — 后端 review 路由 + use case + domain 仍保留（向后兼容）", () => {
  // 后端 review 模块暂保留，避免破坏迁移与既有测试。后续可单独重构删除。
  assert(
    fileExists("backend/presentation/routes/structured-modules.route.ts"),
    "structured-modules.route.ts 必须存在",
  );
  assert(
    fileExists("backend/domain/business-module/review.ts"),
    "review domain 保留（迁移安全）",
  );
  const testSrc = readText("tests/unit/business-module/structured-modules.usecase.test.ts");
  // review 测试用例仍存在 → 证明后端 review 模块没被动
  assertStringIncludes(testSrc, "review");
});

Deno.test("task0 — structured-modules.api.ts 仍保留 review 调用（前端 store 兼容）", () => {
  // 前端 store 仍可能调用（保留向后兼容），仅 UI 层取消展示
  const src = readText("frontend/src/features/business-module/api/structured-modules.api.ts");
  assertStringIncludes(src, "/reviews");
});