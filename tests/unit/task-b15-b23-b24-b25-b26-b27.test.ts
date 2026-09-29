/**
 * 任务 17-27：取消 markdown 模块 AI 生成按钮（11 个模块统一）+ 调查任务批量 + 调查问卷脑图
 *
 * MarkdownModuleView 一次删除「AI 生成」按钮 = 覆盖
 *   - 案件前提条件 (markdown_precondition)         t17
 *   - ROI 分析 (markdown_roi)                      t18
 *   - TO-BE 蓝图 (markdown_to_be)                  t19
 *   - 风险分析 (markdown_risk)                      t20
 *   - IT/技术环境 (markdown_it_environment)        t21
 *   - 非功能需求 (markdown_non_functional)         t22
 *   - 构想方案 (markdown_proposal)                 t23
 *   - 业务现状 (markdown_business_current)         t26
 *   - 现状问题点/痛点 (markdown_pain_point)        t27
 *   - 改善目标 (markdown_improvement)              t27 (改善目标 也归入)
 *   - 硬件设备成本 (markdown_hardware_cost)         隐含（用同视图）
 *
 * 调查任务 (SurveyTaskListView) 取消「一键批量」按钮      t24
 * 调查问卷 (QuestionnaireView)  取消「从脑图生成问题」按钮 t25
 *
 * 验证：
 *   - MarkdownModuleView 不再有 AI 生成 button + onGenerate 函数 + generating ref
 *   - SurveyTaskListView 不再有「一键批量」按钮 + 批量 dialog + showBatchDialog/batchTopics/batchSelected
 *   - QuestionnaireView 不再有「从脑图生成问题」按钮
 *   - 所有 auto-mode 仍可触发的 onBatchGenerate / onBatchFromMindmap / markdown-module-service.generate 函数保留
 */

import { assert, assertStringIncludes } from "@std/assert";

function readText(rel: string): string {
  return Deno.readTextFileSync(`${Deno.cwd()}/${rel}`);
}

Deno.test("b17-23/26 — MarkdownModuleView 不再有「AI 生成」按钮", () => {
  const src = readText("frontend/src/features/business-module/components/MarkdownModuleView.vue");
  // 排除 HTML 注释
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  assert(
    !/<button[^>]*>\s*\{\{\s*generating\s*\?\s*"生成中…"[^<]*\}\}/.test(codeOnly),
    "不应再有 AI 生成 / 生成中… 按钮",
  );
  assert(!/AI\s*生成/.test(codeOnly), "模板中不应再有「AI 生成」字样");
});

Deno.test("b17-23/26 — MarkdownModuleView 删 onGenerate + generating ref", () => {
  const src = readText("frontend/src/features/business-module/components/MarkdownModuleView.vue");
  // onGenerate 已删除
  assert(!/async function onGenerate\b/.test(src), "onGenerate 函数不应再存在");
  // generating ref 已删除
  assert(!/const generating\b/.test(src), "generating ref 不应再存在");
});

Deno.test("b17-23/26 — MarkdownModuleView 仍保留「下载」「采用/不采用」按钮", () => {
  const src = readText("frontend/src/features/business-module/components/MarkdownModuleView.vue");
  assertStringIncludes(src, "onDownload");
  assertStringIncludes(src, ">下载<");
  assertStringIncludes(src, ">采用<");
  assertStringIncludes(src, ">不采用<");
});

Deno.test("b24 — SurveyTaskListView 不再有「一键批量」按钮 + 批量 dialog", () => {
  const src = readText("frontend/src/features/business-module/components/SurveyTaskListView.vue");
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  assert(!/<el-button[^>]*>\s*一键批量\s*<\/el-button>/.test(codeOnly), "不应再有「一键批量」按钮");
  assert(!codeOnly.includes("showBatchDialog"), "showBatchDialog 状态不应再被引用");
  assert(!codeOnly.includes("batchTopics"), "batchTopics 状态不应再被引用");
  assert(!codeOnly.includes("batchSelected"), "batchSelected 状态不应再被引用");
  assert(!/v-model="showBatchDialog"/.test(src), "批量 dialog 不应再渲染");
  assert(!/"AI 一键批量生成"/.test(src), "批量 dialog 标题不应再出现");
});

Deno.test("b24 — SurveyTaskListView 保留 auto-mode 调用入口（注释说明）", () => {
  const src = readText("frontend/src/features/business-module/components/SurveyTaskListView.vue");
  // 至少 + 新建调查 按钮还在
  assert(/<el-button[^>]*>\s*\+\s*新建调查\s*<\/el-button>/.test(src));
  // store.batchGenerate 调用应在 store 中保留
  const store = readText("frontend/src/features/business-module/stores/survey-task.store.ts");
  assert(/batchGenerate\b/.test(store), "store.batchGenerate 应保留（auto-mode 调用）");
});

Deno.test("b25 — QuestionnaireView 不再有「从脑图生成问题」按钮", () => {
  const src = readText("frontend/src/features/business-module/components/QuestionnaireView.vue");
  const codeOnly = src.replace(/<!--[\s\S]*?-->/g, "");
  assert(
    !/<el-button[^>]*>\s*从脑图生成问题\s*<\/el-button>/.test(codeOnly),
    "不应再有「从脑图生成问题」按钮",
  );
  assert(!/@click="onBatchFromMindmap"/.test(codeOnly), "不应再绑 onBatchFromMindmap 点击");
});

Deno.test("b25 — QuestionnaireView 保留 onBatchFromMindmap 函数（auto-mode 调用）", () => {
  const src = readText("frontend/src/features/business-module/components/QuestionnaireView.vue");
  // 函数还在
  assert(/async function onBatchFromMindmap\b/.test(src), "onBatchFromMindmap 函数应保留");
  // 后端 API 调用还在
  assert(/surveyQuestionnaireApi\.batchFromMindmap\(/.test(src));
  // 空状态文案不再提及「从脑图生成问题」
  const emptyMatch = src.match(/v-if="questions\.length === 0"[\s\S]*?<\/div>/);
  assert(emptyMatch, "应有空状态块");
  assert(!emptyMatch![0].includes("从脑图生成问题"), "空状态文案不应再提及「从脑图生成问题」");
});