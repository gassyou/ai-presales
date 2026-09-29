/**
 * 任务 4：客户联系人删除主联系人列 —— 测试
 *
 * 验证：
 *   - ContactsView 表头不再有"主联系人"列
 *   - 行内不再有"主联系人"span / "设为主联系人"按钮
 *   - 新增/编辑 modal 不再有"设为主联系人"checkbox
 *   - setPrimary() 函数已被移除（避免死代码）
 *   - isPrimary 字段保留在 DTO（EmailComposerDialog 等后台逻辑仍可用）
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b4 — ContactsView 表头不再有「主联系人」列", () => {
  const src = readText("frontend/src/features/business-module/components/ContactsView.vue");
  assert(!src.includes("<th class=\"w-16 py-2\">主联系人</th>"), "不应再有主联系人 th");
});

Deno.test("b4 — ContactsView 行内不再渲染主联系人 span / 按钮", () => {
  const src = readText("frontend/src/features/business-module/components/ContactsView.vue");
  // 排除注释行（仅在模板/脚本中匹配）
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\/.*$/gm, "");
  assert(!codeOnly.includes(">主联系人</span>"), "不应再有 >主联系人< span");
  assert(!codeOnly.includes("setPrimary(c.id)"), "不应再有 setPrimary 调用");
  // 设为主联系人 不能是元素文本（注释已豁免）
  assert(!/<[a-z][^>]*>[\s]*设为主联系人[\s]*<\//.test(codeOnly), "不应再有「设为主联系人」按钮/checkbox 元素");
});

Deno.test("b4 — 新增/编辑 modal 不再有「设为主联系人」checkbox", () => {
  const src = readText("frontend/src/features/business-module/components/ContactsView.vue");
  // modal 里只应保留 el-input 行
  assert(!src.includes("modal.isPrimary"), "modal isOpen 应不再引用 isPrimary");
});

Deno.test("b4 — setPrimary() 函数体已删除", () => {
  const src = readText("frontend/src/features/business-module/components/ContactsView.vue");
  assert(!/function setPrimary\s*\(/.test(src), "setPrimary 函数不应再存在");
});

Deno.test("b4 — isPrimary 字段仍在 ContactDTO（保留后台逻辑）", () => {
  const api = readText("frontend/src/features/project/api/contacts.api.ts");
  assertStringIncludes(api, "isPrimary");
});