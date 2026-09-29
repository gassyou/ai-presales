/**
 * 任务 20（阶段 1）：项目状态切换按钮 + 4 target 通用 dialog + 后端字段透传 —— 测试
 *
 * 覆盖：
 *   - shared DTO ChangeProjectStatusInput: 5 个新字段声明
 *   - project.route.ts handler: 5 个新字段透传到 service payload
 *   - ProjectStatusChangeDialog: 4 个 target 分支渲染（中标/未中标/中止/暂停）
 *   - ProjectDetailView: 主按钮区 + 次按钮区 + 4 个 computed (canMarkWon/Lost/Pause/Abort)
 *   - 状态机可见性矩阵（pure function）：每个 status 对哪些按钮为 true
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const PROJECT_STATUSES = ["新建", "提案中", "暂停", "中标", "未中标", "中止"] as const;
type Status = typeof PROJECT_STATUSES[number];

// 复用 ProjectDetailView.vue 里的常量逻辑（保持文档化；改源时这里也同步改）
function canMarkWon(s: Status): boolean {
  return s === "提案中" || s === "暂停";
}
function canMarkLost(s: Status): boolean {
  return s === "提案中" || s === "暂停";
}
function canPause(s: Status): boolean {
  return s === "提案中";
}
function canAbort(s: Status): boolean {
  return s === "提案中" || s === "暂停";
}

// ----- 1. DTO -----

Deno.test({
  name: "t20 — shared DTO ChangeProjectStatusInput 含 5 个新字段",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile("shared/types/dto/project.ts");
    assertStringIncludes(src, "ChangeProjectStatusInput");
    assertStringIncludes(src, "wonDate?");
    assertStringIncludes(src, "bestPractice?");
    assertStringIncludes(src, "lostDate?");
    assertStringIncludes(src, "lostReason?");
    assertStringIncludes(src, "improvementNote?");
    // 既有字段保留
    assertStringIncludes(src, "pausedDate?");
    assertStringIncludes(src, "stopReason?");
  },
});

// ----- 2. 后端 route handler 透传 -----

Deno.test({
  name: "t20 — project.route.ts changeStatus handler 透传 wonDate/bestPractice/lostDate/lostReason/improvementNote",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "backend/presentation/routes/project.route.ts",
    );
    // raw 输入类型注解
    assertStringIncludes(src, "wonDate?: string;");
    assertStringIncludes(src, "bestPractice?: string;");
    assertStringIncludes(src, "lostDate?: string;");
    assertStringIncludes(src, "lostReason?: string;");
    assertStringIncludes(src, "improvementNote?: string;");
    // payload 透传
    assertStringIncludes(src, 'parseIsoDate(input.wonDate, "wonDate")');
    assertStringIncludes(src, 'parseIsoDate(input.lostDate, "lostDate")');
    assertStringIncludes(src, "payload.bestPractice");
    assertStringIncludes(src, "payload.lostReason");
    assertStringIncludes(src, "payload.improvementNote");
    // 调用 service 沿用旧签名
    assertStringIncludes(src, "deps.service.changeProjectStatus(");
  },
});

// ----- 3. Dialog 4 target 分支 -----

Deno.test({
  name: "t20 — ProjectStatusChangeDialog 支持 4 个 target 的字段渲染分支",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/components/ProjectStatusChangeDialog.vue",
    );
    // 中标
    assertStringIncludes(src, 'target === \'中标\'');
    assertStringIncludes(src, "form.wonDate");
    assertStringIncludes(src, "form.bestPractice");
    // 未中标
    assertStringIncludes(src, 'target === \'未中标\'');
    assertStringIncludes(src, "form.lostDate");
    assertStringIncludes(src, "form.lostReason");
    assertStringIncludes(src, "form.improvementNote");
    // 中止（保持 PR #1 既有）
    assertStringIncludes(src, 'target === \'中止\'');
    assertStringIncludes(src, "form.pausedDate");
    assertStringIncludes(src, "form.stopReason");
    // 暂停
    assertStringIncludes(src, 'target === \'暂停\'');
    assertStringIncludes(src, "form.reason");
    // 校验
    assertStringIncludes(src, "canSubmit");
    assertStringIncludes(src, "buildForm");
    assertStringIncludes(src, "nowLocalIso");
  },
});

// ----- 4. ProjectDetailView 主次分区 -----

Deno.test({
  name: "t20 — ProjectDetailView 主按钮区 + 次按钮区 + 4 computed + openStatusDialog",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/ProjectDetailView.vue",
    );
    // 主按钮区 + 状态结果
    assertStringIncludes(src, "canDecideResult");
    assertStringIncludes(src, 'type="success"');
    assertStringIncludes(src, 'type="warning"');
    assertStringIncludes(src, "中标");
    assertStringIncludes(src, "未中标");
    // 次按钮区
    assertStringIncludes(src, "canPause");
    assertStringIncludes(src, "canAbort");
    assertStringIncludes(src, ">暂停<");
    assertStringIncludes(src, ">中止<");
    // 4 个 computed
    assertStringIncludes(src, "canMarkWon");
    assertStringIncludes(src, "canMarkLost");
    assertStringIncludes(src, "canAbort");
    assertStringIncludes(src, "canPause");
    // 通用 dialog 入口
    assertStringIncludes(src, "openStatusDialog");
    assertStringIncludes(src, "DECIDABLE_STATUSES");
    assertStringIncludes(src, "PAUSABLE_STATUSES");
    // 状态变更文案
    assertStringIncludes(src, "STATUS_SUCCESS_LABEL");
  },
});

// ----- 5. 状态机可见性矩阵 -----

Deno.test({
  name: "t20 — 状态机可见性矩阵：每个 status 对哪些按钮可见",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const expect: Record<Status, { won: boolean; lost: boolean; pause: boolean; abort: boolean }> = {
      "新建":   { won: false, lost: false, pause: false, abort: false },
      "提案中": { won: true,  lost: true,  pause: true,  abort: true },
      "暂停":   { won: true,  lost: true,  pause: false, abort: true },
      "中标":   { won: false, lost: false, pause: false, abort: false },
      "未中标": { won: false, lost: false, pause: false, abort: false },
      "中止":   { won: false, lost: false, pause: false, abort: false },
    };
    for (const s of PROJECT_STATUSES) {
      assertEquals(canMarkWon(s), expect[s].won, `canMarkWon(${s})`);
      assertEquals(canMarkLost(s), expect[s].lost, `canMarkLost(${s})`);
      assertEquals(canPause(s), expect[s].pause, `canPause(${s})`);
      assertEquals(canAbort(s), expect[s].abort, `canAbort(${s})`);
    }
  },
});

// ----- 6. PROJECT_STATUSES 6 个值与状态机对齐 -----

Deno.test({
  name: "t20 — 6 个 status 值与后端 PROJECT_STATUSES 一致",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile("backend/domain/project/project-status.ts");
    for (const s of PROJECT_STATUSES) {
      assertStringIncludes(src, `"${s}"`);
    }
  },
});

// ----- 7. dialog 文案 4 套 -----

Deno.test({
  name: "t20 — dialog title/confirm 文案覆盖 4 个 target",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/components/ProjectStatusChangeDialog.vue",
    );
    assertStringIncludes(src, "项目中标");
    assertStringIncludes(src, "项目未中标");
    assertStringIncludes(src, "中止项目");
    assertStringIncludes(src, "暂停项目");
    assertStringIncludes(src, "确认中标");
    assertStringIncludes(src, "确认未中标");
    assertStringIncludes(src, "确认中止");
    assertStringIncludes(src, "确认暂停");
  },
});

// ----- 8. STATUS_SUCCESS_LABEL 6 套 -----

Deno.test({
  name: "t20 — STATUS_SUCCESS_LABEL 含全部 6 个 status",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/ProjectDetailView.vue",
    );
    for (const s of PROJECT_STATUSES) {
      assertStringIncludes(src, `"${s}":`);
    }
  },
});
