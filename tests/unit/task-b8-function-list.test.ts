/**
 * 任务 8-16：功能清单 6 项问题 + AI 生成 + 导出 Excel —— 复合测试
 *
 * t8a (B8):   3 模式切换 - el-radio-button 用 :value 而不是 value
 * t8b (B9):   无法新增功能 - 加 editError + 必填校验 + 失败回显
 * t8c (B10):  脑图/卡片占满剩余高度 - 包 flex-1 min-h-0 容器
 * t8d (B11):  筛选栏仅列表模式显示 + 一行内
 * t8e (B12):  列表模式下 in_scope/CP 可编辑（emit toggleScope/changeCp 保留）
 * t15:        取消「AI 生成」按钮
 * t16:        导出 CSV 改 Excel（用 exceljs 库，已在 import map 中）
 */

import { assert, assertStringIncludes, assertEquals } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b8 — 视图模式切换：el-radio-button 用 :value 绑定", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  // 三个 mode 都用 :value="'...'" 而不是裸 value=
  assertStringIncludes(src, `<el-radio-button :value="'table'">列表</el-radio-button>`);
  assertStringIncludes(src, `<el-radio-button :value="'mindmap'">脑图</el-radio-button>`);
  assertStringIncludes(src, `<el-radio-button :value="'cards'">卡片</el-radio-button>`);
});

Deno.test("b9 — 新增功能：必填校验 + editError 回显", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  // editError ref
  assertStringIncludes(src, "const editError = ref<string | null>(null);");
  // 校验：name 为空时弹错
  const onSaveMatch = src.match(/async function onSave\s*\(\)\s*:\s*Promise<void>\s*\{[\s\S]*?\n\}/);
  assert(onSaveMatch, "应有 onSave 函数");
  const body = onSaveMatch![0];
  assertStringIncludes(body, "请填写「功能名」");
  // dialog 内显示错误
  assert(
    /<p v-if="editError"[^>]*>\{\{ editError \}\}<\/p>/.test(src),
    "dialog 应显示 editError 文案",
  );
  // 失败回显 store.functionError
  assertStringIncludes(body, "store.functionError");
});

Deno.test("b10 — 脑图 / 卡片视图占满剩余高度", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  // mindmap 包了 flex min-h-0 flex-1 flex-col wrapper
  assert(
    /v-else-if="viewMode === 'mindmap'"[\s\S]*?class="flex min-h-0 flex-1 flex-col"/.test(src),
    "mindmap 视图应有 flex-1 min-h-0 wrapper",
  );
  // 列表 + cards 视图带 flex-1 class
  assert(/class="min-h-\[300px\] flex-1"/.test(src), "列表/卡片视图应有 flex-1 类");
});

Deno.test("b11 — 筛选栏仅列表模式显示", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  // filter row 有 v-if="viewMode === 'table'"
  assert(
    /v-if="viewMode === 'table'"[\s\S]*?v-model="filterCategory"[\s\S]*?v-model="filterModule"[\s\S]*?v-model="filterName"/.test(
      src,
    ),
    "筛选栏 3 个 input 应在 viewMode === 'table' 下",
  );
  // 每个 input 固定宽度 11rem（!w-44）确保一行内
  const filterBlock = src.match(/v-if="viewMode === 'table'"[\s\S]*?<\/div>/);
  assert(filterBlock, "应能匹配筛选栏 div");
  const inputMatches = filterBlock![0].match(/class="!w-44"/g) ?? [];
  assert(inputMatches.length >= 3, `筛选 input 应有 3 个 !w-44，实际 ${inputMatches.length}`);
});

Deno.test("b12 — 列表模式下 in_scope checkbox 与 CP select 可编辑", () => {
  const table = readText("frontend/src/features/business-module/components/FunctionListTable.vue");
  // el-checkbox @change emit toggleScope
  assert(/<el-checkbox[\s\S]*?@change="emit\('toggleScope'/.test(table));
  // el-select @change emit changeCp
  assert(/<el-select[\s\S]*?@change="\(v\) => emit\('changeCp'/.test(table));
  // emits 定义中 toggleScope / changeCp 都存在
  assert(/toggleScope/.test(table));
  assert(/changeCp/.test(table));
});

Deno.test("b15 — 功能清单取消「AI 生成」按钮", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  // 不应有 "AI 生成" button
  assert(!/<button[^>]*>[\s]*AI\s*生成[\s]*<\/button>/.test(codeOnly));
  // 不应再有 onAiGenerate 函数
  assert(!/function onAiGenerate\b/.test(codeOnly));
  // 不应再有 aiGenerating ref
  assert(!/const aiGenerating\b/.test(codeOnly));
});

Deno.test("b16 — 导出 CSV 改 Excel", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  // import ExcelJS
  assertStringIncludes(src, `import ExcelJS from "exceljs";`);
  // onExportExcel 函数存在
  assert(/function onExportExcel\b/.test(src));
  // 按钮调用 onExportExcel + 文字「导出 Excel」
  assertStringIncludes(src, '@click="onExportExcel"');
  assert(/<el-button[^>]*>\s*导出\s*Excel\s*<\/el-button>/.test(src));
  // 不应再有 onExportCsv / function csv
  assert(!/function onExportCsv\b/.test(src));
  assert(!/function csv\(.+\)/.test(src));
});

Deno.test("b16 — Excel workbook 正确构造 5 列 + 写入 in-scope 行", () => {
  const src = readText("frontend/src/features/business-module/components/FunctionListView.vue");
  const m = src.match(/function onExportExcel[\s\S]*?URL\.revokeObjectURL/);
  assert(m, "应能匹配 onExportExcel 实现到 revokeObjectURL 收尾");
  const block = m![0];
  // 5 列
  assertEquals(block.match(/header:/g)?.length ?? 0, 5);
  // 仅 in-scope
  assertStringIncludes(block, "filter((it) => it.inScope)");
  // .xlsx 下载（template literal）
  assertStringIncludes(block, ".xlsx`");
});