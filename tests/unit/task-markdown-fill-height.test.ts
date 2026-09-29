/**
 * 任务：MarkdownEditor 在常规布局下高度占满父容器，弹框/抽屉中保持原状
 *
 * 覆盖：
 *   - MarkdownEditor.vue 定义 fillHeight prop（默认 true）
 *   - MarkdownEditor.vue 模板根据 fillHeight 切换 wrapper class
 *   - MarkdownEditor.vue 在 fillHeight=true 时给 .md-editor-wrapper 设置 height: 100%
 *   - MarkdownEditor.vue 在 fillHeight=false 时不给 wrapper 设置 height: 100%
 *   - 弹框/抽屉场景下的调用方显式传 :fill-height="false"
 *     · SurveyTaskListView.vue（el-drawer）
 *     · UseCaseView.vue（el-dialog）
 *     · ActivityListView.vue（el-drawer，两处）
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const MD_EDITOR_PATH = "frontend/src/shared/ui/MarkdownEditor.vue";

Deno.test({
  name: "MarkdownEditor —— 定义 fillHeight prop，默认 true",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(MD_EDITOR_PATH);
    assertStringIncludes(
      text,
      "fillHeight",
      "MarkdownEditor.vue 应定义 fillHeight prop",
    );
    // 默认值应为 true（让现有页面布局自动占满）
    assertStringIncludes(
      text,
      "fillHeight?: boolean",
      "fillHeight 应是可选 boolean 类型",
    );
    assertStringIncludes(
      text,
      "fillHeight: true",
      "fillHeight 默认值应为 true",
    );
  },
});

Deno.test({
  name: "MarkdownEditor —— 模板根据 fillHeight 切换 wrapper class",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(MD_EDITOR_PATH);
    // 模板里 class 应有条件分支
    assertStringIncludes(
      text,
      "md-editor-wrapper--fill",
      "模板应使用 fill 类名以便 CSS 按需启用 height: 100%",
    );
    // wrapper 元素上应绑定 fillHeight
    assertStringIncludes(
      text,
      ":class=\"fillHeight ? 'md-editor-wrapper md-editor-wrapper--fill' : 'md-editor-wrapper'\"",
      "wrapper class 应根据 fillHeight 条件切换",
    );
  },
});

Deno.test({
  name: "MarkdownEditor —— fillHeight=true 时 wrapper 高度 100%",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(MD_EDITOR_PATH);
    assertStringIncludes(
      text,
      ".md-editor-wrapper--fill",
      "应存在 .md-editor-wrapper--fill 选择器",
    );
    // 提取 CSS 块做粗略断言
    const cssMatch = text.match(/\.md-editor-wrapper--fill\s*\{[^}]*\}/);
    assert(cssMatch !== null, "应存在 .md-editor-wrapper--fill CSS 规则");
    const cssBody = cssMatch![0];
    assertStringIncludes(
      cssBody,
      "height: 100%",
      "fill 状态下 wrapper 应设 height: 100%",
    );
  },
});

Deno.test({
  name: "MarkdownEditor —— fillHeight=false 时 wrapper 不强制高度",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(MD_EDITOR_PATH);
    // 基础 .md-editor-wrapper 不应设置 height: 100%（避免破坏弹框/抽屉）
    // 注意：.md-editor-wrapper--fill 选择器会设 height: 100%，所以检查的是基类本身
    // 用正则匹配基类（后面不跟 --fill）的规则体
    const baseMatch = text.match(/\.md-editor-wrapper\s*\{[^}]*\}/);
    assert(baseMatch !== null, "应存在基础 .md-editor-wrapper CSS 规则");
    const baseBody = baseMatch![0];
    assertEquals(
      baseBody.includes("height: 100%"),
      false,
      "基础 .md-editor-wrapper 不应设 height: 100%（否则弹框/抽屉会被撑满）",
    );
  },
});

Deno.test({
  name: "SurveyTaskListView —— 抽屉中的 MarkdownEditor 显式关闭 fillHeight",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/business-module/components/SurveyTaskListView.vue",
    );
    assertStringIncludes(
      text,
      '<MarkdownEditor',
      "SurveyTaskListView.vue 应有 MarkdownEditor 调用",
    );
    assertStringIncludes(
      text,
      ':fill-height="false"',
      "SurveyTaskListView.vue 的 MarkdownEditor 调用应传 :fill-height=\"false\"（在抽屉里）",
    );
  },
});

Deno.test({
  name: "UseCaseView —— 弹框中的 MarkdownEditor 显式关闭 fillHeight",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/business-module/components/UseCaseView.vue",
    );
    assertStringIncludes(
      text,
      '<MarkdownEditor',
      "UseCaseView.vue 应有 MarkdownEditor 调用",
    );
    assertStringIncludes(
      text,
      ':fill-height="false"',
      "UseCaseView.vue 的 MarkdownEditor 调用应传 :fill-height=\"false\"（在 el-dialog 弹框里）",
    );
  },
});

Deno.test({
  name: "ActivityListView —— 抽屉中的 MarkdownEditor 全部关闭 fillHeight",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(
      "frontend/src/features/business-module/components/ActivityListView.vue",
    );
    const matches = text.match(/<MarkdownEditor[^>]*>/g) ?? [];
    assert(
      matches.length >= 2,
      `ActivityListView.vue 应至少有 2 个 MarkdownEditor（成果 + 课题），实际 ${matches.length}`,
    );
    for (const m of matches) {
      assertStringIncludes(
        m,
        ':fill-height="false"',
        `ActivityListView.vue 中每个 MarkdownEditor 都应传 :fill-height="false"，缺失：${m}`,
      );
    }
  },
});