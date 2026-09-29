/**
 * 任务：调查任务列表的「开始调查」按钮文案 + 「执行中 N 秒」实时计时
 *
 * 覆盖：
 *   - SurveyTaskListView.vue 把「执行」按钮文案改成「开始调查」
 *   - running 状态下，状态列显示「执行中 Ns / Nm Ks」+ loading 转圈
 *   - 组件 script 引用 formatElapsed(now ref + 1s tick)
 *   - formatElapsed 纯函数输出符合预期
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";

const VIEW_PATH =
  "frontend/src/features/business-module/components/SurveyTaskListView.vue";
const LIB_PATH =
  "frontend/src/features/business-module/lib/format-elapsed.ts";

// -----------------------------------------------------------------------------
// 按钮文案
// -----------------------------------------------------------------------------

Deno.test({
  name: "SurveyTaskListView —— idle 行「执行」按钮文案改为「开始调查」",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(VIEW_PATH);
    // onStart 按钮文案应是「开始调查」
    assertStringIncludes(
      text,
      "@click=\"onStart(t.id)\"",
      "idle 行 onStart 按钮应存在",
    );
    assertStringIncludes(
      text,
      ">开始调查</el-button>",
      "idle 行按钮文案应为「开始调查」",
    );
    // 旧文案「>执行</el-button>」不应再出现（保留「执行中」状态文案）
    assertEquals(
      text.includes(">执行</el-button>"),
      false,
      "按钮文案不应再是「执行」",
    );
  },
});

// -----------------------------------------------------------------------------
// 状态列：执行中 + loading + Ns
// -----------------------------------------------------------------------------

Deno.test({
  name: "SurveyTaskListView —— running 状态显示 loading 图标 + 「执行中 Ns」",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(VIEW_PATH);
    assertStringIncludes(
      text,
      "el-icon",
      "状态列应使用 el-icon 显示 loading 转圈",
    );
    assertStringIncludes(
      text,
      "is-loading",
      "loading 图标应加 is-loading class",
    );
    assertStringIncludes(
      text,
      "执行中",
      "running 状态文案应包含「执行中」",
    );
    // 状态列模板里应调用 formatElapsed 并把结果拼到文案上
    assertStringIncludes(
      text,
      "formatElapsed",
      "SurveyTaskListView.vue 应 import 并使用 formatElapsed",
    );
  },
});

// -----------------------------------------------------------------------------
// script 部分：now ref + 1s tick
// -----------------------------------------------------------------------------

Deno.test({
  name: "SurveyTaskListView —— script 引入 formatElapsed、维护 now ref 与 1s 定时器",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const text = await Deno.readTextFile(VIEW_PATH);
    assertStringIncludes(
      text,
      'import { formatElapsed } from',
      "应 import formatElapsed",
    );
    assertStringIncludes(
      text,
      'from "../lib/format-elapsed.ts"',
      "应从 lib/format-elapsed.ts 导入",
    );
    assertStringIncludes(
      text,
      "const now = ref",
      "应定义 now ref 用于驱动每秒重算",
    );
    assertStringIncludes(
      text,
      "setInterval(",
      "应用 setInterval 每秒 tick",
    );
    assertStringIncludes(
      text,
      "1000",
      "tick 间隔应为 1000ms（1 秒）",
    );
    // 必须有卸载清理（onUnmounted 或 beforeUnmount）
    assert(
      /\bonUnmounted\s*\(/.test(text) || /\bbeforeUnmount\s*\(/.test(text),
      "卸载时应清理 setInterval，避免内存泄漏",
    );
    assertStringIncludes(
      text,
      "clearInterval",
      "卸载时应调用 clearInterval",
    );
  },
});

// -----------------------------------------------------------------------------
// 纯函数测试
// -----------------------------------------------------------------------------

Deno.test({
  name: "formatElapsed —— 纯函数：< 60s 显示 Ns，>= 60s 显示 Nm Ks",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const mod = await import(
      `../../frontend/src/features/business-module/lib/format-elapsed.ts`
    );
    const { formatElapsed } = mod as {
      formatElapsed: (
        startedAt: string | undefined | null,
        nowMs: number,
      ) => string;
    };
    const start = "2026-09-29T10:00:00.000Z";
    const base = Date.parse(start);

    assertEquals(formatElapsed(undefined, base + 5_000), "");
    assertEquals(formatElapsed(null, base + 5_000), "");
    assertEquals(formatElapsed("not-a-date", base + 5_000), "");
    assertEquals(formatElapsed(start, base), "0s");
    assertEquals(formatElapsed(start, base + 5_000), "5s");
    assertEquals(formatElapsed(start, base + 59_000), "59s");
    assertEquals(formatElapsed(start, base + 60_000), "1m 0s");
    assertEquals(formatElapsed(start, base + 125_000), "2m 5s");
    // 时钟漂移：now < startedAt 时不应返回负数
    assertEquals(formatElapsed(start, base - 1_000), "0s");
  },
});