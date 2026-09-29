/**
 * 任务 3：取消系统设置中的工具设置 —— 测试
 *
 * 用户原话："取消系统设置中的工具设置功能，默认所有 agent 和 subagent
 * 都能访问这些系统工具。"
 *
 * 验证：
 *   1. SettingsView 不再有"工具配置" tab
 *   2. ToolConfigsTab.vue 已删除
 *   3. SettingsView 不再 import ToolConfigsTab
 *   4. settings.store.ts 不再有 toolConfigs state / loadToolConfigs / saveToolConfigs
 *   5. settings.api.ts 不再有 getToolConfigs / updateToolConfigs / ToolConfigs 类型
 *   6. 后端路由保留（向后兼容）：toolConfigs 仍可读但不会从 UI 触发写入
 *   7. "默认全开"语义：ToolRegistry 默认暴露所有工具（无须 toolConfig 启用）
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = Deno.cwd();

function readText(rel: string): string {
  return Deno.readTextFileSync(join(projectRoot, rel));
}

// ===== UI 已删除 =====

Deno.test("t3 — SettingsView 不再有 label='工具配置' 的 tab-pane", () => {
  const src = readText("frontend/src/features/settings/SettingsView.vue");
  const template = src.match(/<template>[\s\S]*?<\/template>/);
  assert(template);
  assert(!template[0].includes('label="工具配置"'), "不应再有 工具配置 tab");
  assert(!template[0].includes('name="tools"'), "不应再有 name=tools tab");
});

Deno.test("t3 — SettingsView 不再 import ToolConfigsTab", () => {
  const src = readText("frontend/src/features/settings/SettingsView.vue");
  assert(!src.includes("ToolConfigsTab"), "不再 import ToolConfigsTab");
});

Deno.test("t3 — ToolConfigsTab.vue 文件已删除", () => {
  assert(
    !existsSync(join(projectRoot, "frontend/src/features/settings/components/ToolConfigsTab.vue")),
    "ToolConfigsTab.vue 必须已删除",
  );
});

// ===== Store 已清理 =====

Deno.test("t3 — settings.store.ts 不再含 toolConfigs state", () => {
  const src = readText("frontend/src/features/settings/stores/settings.store.ts");
  // 注释里的提及不算；只检查实际声明/赋值
  // 找 "const toolConfigs = ref" — 不应再有
  assert(!/const\s+toolConfigs\s*=\s*ref/.test(src), "toolConfigs state 应已删除");
  assert(!/loadToolConfigs\s*\(/.test(src.replace(/function loadToolConfigs/, "")), "loadToolConfigs 应已删除");
  assert(!/saveToolConfigs\s*\(/.test(src.replace(/function saveToolConfigs/, "")), "saveToolConfigs 应已删除");
});

Deno.test("t3 — settings.api.ts 不再有 ToolConfig 类型", () => {
  const src = readText("frontend/src/features/settings/api/settings.api.ts");
  assert(!src.includes("ToolConfigValue"), "ToolConfigValue 类型应已删除");
  assert(!src.includes("ToolConfigsSettingDTO"), "ToolConfigsSettingDTO 应已删除");
  assert(!src.includes("ToolConfigsReadDTO"), "ToolConfigsReadDTO 应已删除");
  assert(!src.includes("getToolConfigs()"), "getToolConfigs() 方法应已删除");
  assert(!src.includes("updateToolConfigs("), "updateToolConfigs 方法应已删除");
});

Deno.test("t3 — SettingsSnapshotDTO 不再含 toolConfigs 字段", () => {
  const src = readText("frontend/src/features/settings/api/settings.api.ts");
  // 注释不算；实际 type 定义里不应有 toolConfigs:
  const blob = src.match(/interface SettingsSnapshotDTO\s*{[\s\S]*?}/);
  assert(blob,
    "SettingsSnapshotDTO 必须存在",
  );
  assert(!/^\s*toolConfigs\s*:\s/m.test(blob[0]), "SettingsSnapshotDTO 不应再有 toolConfigs 字段");
});

// ===== 后端保留（向后兼容） =====

Deno.test("t3 — 后端 settings.route 保留 /api/settings/tool-configs 路由", () => {
  const src = readText("backend/presentation/routes/settings.route.ts");
  // 后端默认继续可读 tool configs；UI 删了写入入口，但 GET 仍工作
  // —— 后端任意 tool configs 路由条目应保留
  assert(
    src.includes("tool-configs") || src.includes("getToolConfigs"),
    "后端应保留 tool configs 路由（向后兼容）",
  );
});

Deno.test("t3 — 后端 ConfigurableToolRegistry 默认行为是'全开'", () => {
  // 关键安全性保证：没有 tool config 行时，所有 tool 仍然可访问
  // 通过 maybeApplyConfig 的 if (!latestUpdatedAt) return 路径验证
  const src = readText("backend/application/settings/configurable-tool-registry.ts");
  assertStringIncludes(src, "if (!latestUpdatedAt) return");
});

// ===== 端到端：默认全开 =====

import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { listFilesTool } from "@backend/ai/tool/builtin/list-files.tool.ts";

Deno.test("t3 — ToolRegistry 默认暴露所有注册的工具（不依赖 toolConfig 启用）", () => {
  const reg = new ToolRegistry();
  reg.register(currentDatetimeTool);
  reg.register(listFilesTool);
  // 默认（无任何 toolConfig）→ 全部可访问
  const names = reg.names();
  assert(names.includes("current_datetime"));
  assert(names.includes("list_files"));
});