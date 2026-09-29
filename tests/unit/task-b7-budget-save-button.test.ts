/**
 * 任务 7：成本计算设置加保存按钮 —— 测试
 *
 * 验证：
 *   - 顶部 header 有显式「保存」按钮
 *   - 按钮 disabled 绑定 !dirty || saving
 *   - onSave() 函数存在：取消 pending timer + validate + 调 saveSettings
 *   - 状态文案"有改动未保存"
 *   - debounce 自动保存保留（watch 仍在）
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b7 — BudgetSettingsView 顶部 header 含「保存」按钮", () => {
  const src = readText("frontend/src/features/business-module/components/BudgetSettingsView.vue");
  assert(
    /<button[^>]*>\s*保存\s*<\/button>/.test(src),
    "应有「保存」button 元素",
  );
});

Deno.test("b7 — 保存按钮 disabled 绑定 !dirty || saving", () => {
  const src = readText("frontend/src/features/business-module/components/BudgetSettingsView.vue");
  assert(
    /:disabled="!dirty \|\| saving"/.test(src),
    "按钮应绑 :disabled=\"!dirty || saving\"",
  );
});

Deno.test("b7 — 保存按钮 click 调用 onSave()", () => {
  const src = readText("frontend/src/features/business-module/components/BudgetSettingsView.vue");
  assert(/@click="onSave"/.test(src), "保存按钮应触发 onSave");
});

Deno.test("b7 — onSave() 函数存在 + 取消 timer + 调 saveSettings", () => {
  const src = readText("frontend/src/features/business-module/components/BudgetSettingsView.vue");
  const m = src.match(/async function onSave\s*\([^)]*\)\s*:\s*Promise<void>\s*\{[\s\S]*?\n\}/);
  assert(m, "应有 onSave 函数定义");
  const body = m![0];
  assertStringIncludes(body, "clearTimeout(timer)");
  assertStringIncludes(body, "validate(");
  assertStringIncludes(body, "store.saveSettings(");
  assertStringIncludes(body, "dirty.value = false");
});

Deno.test("b7 — 状态文案「有改动未保存」", () => {
  const src = readText("frontend/src/features/business-module/components/BudgetSettingsView.vue");
  assertStringIncludes(src, "有改动未保存");
});

Deno.test("b7 — debounce 自动保存仍保留", () => {
  const src = readText("frontend/src/features/business-module/components/BudgetSettingsView.vue");
  // watch + setTimeout 应仍在
  assert(/watch\s*\(\s*form/.test(src), "form watcher 应保留");
  assert(/setTimeout\(/.test(src), "debounce setTimeout 应保留");
});