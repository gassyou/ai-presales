/**
 * 任务 20（阶段 1）：项目状态切换按钮 + dialog + 后端字段透传 —— 测试
 *
 * 覆盖：
 *   - shared DTO ChangeProjectStatusInput: 必填字段声明（5 态）
 *   - project.route.ts handler: 透传 wonDate/bestPractice/lostDate/lostReason/improvementNote
 *   - ProjectStatusChangeDialog: 3 个 target 分支渲染（中标/未中标/暂停）
 *   - ProjectDetailView: 主按钮区 + 次按钮区 + 3 个 computed（恢复已移除）
 *   - 状态机可见性矩阵：每个 status 对哪些按钮为 true
 *
 * 注："恢复"功能已撤回——所有 RESUMABLE_STATUSES / canResume / resumeProject 相关源码/测试均已移除。
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";

const PROJECT_STATUSES = ["新建", "提案中", "暂停", "中标", "未中标"] as const;
type Status = typeof PROJECT_STATUSES[number];

// 复用 ProjectDetailView.vue 里的常量逻辑（保持文档化；改源时这里也同步改）
// 注：恢复按钮已移除，canResume 总是 false
function canMarkWon(s: Status): boolean {
  return s === "新建" || s === "提案中" || s === "暂停";
}
function canMarkLost(s: Status): boolean {
  return s === "新建" || s === "提案中" || s === "暂停";
}
function canPause(s: Status): boolean {
  return s === "新建" || s === "提案中";
}
function canResume(_s: Status): boolean {
  return false;
}

// ----- 1. DTO -----

Deno.test({
  name: "t20 — shared DTO ChangeProjectStatusInput 含 pausedDate；不含 stopReason",
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
    assertStringIncludes(src, "pausedDate?", "ChangeProjectStatusInput 应含 pausedDate 字段（暂停时必填）");
    assertFalse(
      src.includes("stopReason?:"),
      "ChangeProjectStatusInput 不应再有 stopReason 字段",
    );
  },
});

// ----- 2. 后端 route handler 透传 -----

Deno.test({
  name: "t20 — project.route.ts changeStatus handler 透传 pausedDate",
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
    assertStringIncludes(src, "pausedDate?: string;");
    // payload 透传
    assertStringIncludes(src, 'parseIsoDate(input.wonDate, "wonDate")');
    assertStringIncludes(src, 'parseIsoDate(input.lostDate, "lostDate")');
    assertStringIncludes(src, 'parseIsoDate(input.pausedDate, "pausedDate")');
    assertStringIncludes(src, "payload.bestPractice");
    assertStringIncludes(src, "payload.lostReason");
    assertStringIncludes(src, "payload.improvementNote");
    assertStringIncludes(src, "payload.pausedDate");
    // 调用 service 沿用旧签名
    assertStringIncludes(src, "deps.service.changeProjectStatus(");
    // 中止字段不应再被路由解析
    assertFalse(src.includes("payload.stopReason"));
    // "恢复"端点已删除
    assertFalse(src.includes('"/resume"'), "resume 路由已删除");
    assertFalse(src.includes("resumeProjectRoute"), "resumeProjectRoute handler 已删除");
    assertFalse(src.includes("deps.service.resumeProject("), "deps.service.resumeProject 调用已删除");
  },
});

// ----- 3. Dialog 3 target 分支（移除中止） -----

Deno.test({
  name: "t20 — ProjectStatusChangeDialog 3 个 target 分支；暂停必填 pausedDate+reason",
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
    // 暂停：日期 + 原因
    assertStringIncludes(src, 'target === \'暂停\'');
    assertStringIncludes(src, "form.pausedDate");
    assertStringIncludes(src, "form.reason");
    // 校验
    assertStringIncludes(src, "canSubmit");
    assertStringIncludes(src, "buildForm");
    assertStringIncludes(src, "nowLocalIso");
    // 中止字段不应再出现
    assertFalse(src.includes("form.stopReason"));
    assertFalse(src.includes('target === \'中止\''));
  },
});

// ----- 4. ProjectDetailView 主次分区 + 恢复按钮 -----

Deno.test({
  name: "t20 — ProjectDetailView 主按钮区 + 恢复按钮 + 4 computed",
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
    assertStringIncludes(src, ">暂停<");
    // 3 个 computed（恢复已移除）
    assertStringIncludes(src, "canMarkWon");
    assertStringIncludes(src, "canMarkLost");
    assertStringIncludes(src, "canPause");
    // 通用 dialog 入口
    assertStringIncludes(src, "openStatusDialog");
    assertStringIncludes(src, "DECIDABLE_STATUSES");
    assertStringIncludes(src, "PAUSABLE_STATUSES");
    // RESUMABLE_STATUSES 已移除
    assertFalse(src.includes("RESUMABLE_STATUSES"));
    assertFalse(src.includes("canResume"));
    assertFalse(src.includes(">恢复<"));
    assertFalse(src.includes("onResume"));
    // 状态变更文案
    assertStringIncludes(src, "STATUS_SUCCESS_LABEL");
    // 中止按钮 / canAbort / openAbortDialog 不应再出现
    assertFalse(src.includes("canAbort"));
    assertFalse(src.includes("openAbortDialog"));
    assertFalse(src.includes(">中止<"));
  },
});

// ----- 5. 状态机可见性矩阵（用 canResume 替代 canAbort） -----

Deno.test({
  name: "t20 — 状态机可见性矩阵：每个 status 对哪些按钮可见",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const expect: Record<Status, { won: boolean; lost: boolean; pause: boolean; resume: boolean }> = {
      "新建":   { won: true,  lost: true,  pause: true,  resume: false },
      "提案中": { won: true,  lost: true,  pause: true,  resume: false },
      "暂停":   { won: true,  lost: true,  pause: false, resume: false },
      "中标":   { won: false, lost: false, pause: false, resume: false },
      "未中标": { won: false, lost: false, pause: false, resume: false },
    };
    for (const s of PROJECT_STATUSES) {
      assertEquals(canMarkWon(s), expect[s].won, `canMarkWon(${s})`);
      assertEquals(canMarkLost(s), expect[s].lost, `canMarkLost(${s})`);
      assertEquals(canPause(s), expect[s].pause, `canPause(${s})`);
      assertEquals(canResume(s), expect[s].resume, `canResume(${s})`);
    }
  },
});

// ----- 6. PROJECT_STATUSES 5 个值与状态机对齐 -----

Deno.test({
  name: "t20 — 5 个 status 值与后端 PROJECT_STATUSES 一致（不含中止）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile("backend/domain/project/project-status.ts");
    for (const s of PROJECT_STATUSES) {
      assertStringIncludes(src, `"${s}"`);
    }
    assertFalse(src.includes('"中止"'), "后端 PROJECT_STATUSES 不应再含中止");
  },
});

// ----- 7. dialog 文案 3 套（移除中止） -----

Deno.test({
  name: "t20 — dialog title/confirm 文案覆盖 3 个 target",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/components/ProjectStatusChangeDialog.vue",
    );
    assertStringIncludes(src, "项目中标");
    assertStringIncludes(src, "项目未中标");
    assertStringIncludes(src, "暂停项目");
    assertStringIncludes(src, "确认中标");
    assertStringIncludes(src, "确认未中标");
    assertStringIncludes(src, "确认暂停");
    assertFalse(src.includes("中止项目"));
    assertFalse(src.includes("确认中止"));
  },
});

// ----- 8. STATUS_SUCCESS_LABEL 5 套（移除中止） -----

Deno.test({
  name: "t20 — STATUS_SUCCESS_LABEL 含全部 5 个 status",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/ProjectDetailView.vue",
    );
    for (const s of PROJECT_STATUSES) {
      assertStringIncludes(src, `"${s}":`);
    }
    assertFalse(src.includes('"中止":'), "STATUS_SUCCESS_LABEL 不应再含中止");
  },
});

// ----- 9. StatusBadge 移除中止 case -----

Deno.test({
  name: "t20 — StatusBadge 不再含中止 case",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/project/components/StatusBadge.vue",
    );
    assertFalse(src.includes('case "中止"'), "StatusBadge 不应再有 中止 case");
  },
});

// ----- 10. 后端 aggregate —— 恢复功能已删除 -----

Deno.test({
  name: "t20 — Project 聚合根不含 markResumed/markStopped",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile("backend/domain/project/project.ts");
    assertFalse(src.includes("markResumed("), "markResumed 已删除");
    assertFalse(src.includes("markStopped("), "聚合根不应再有 markStopped 方法");
  },
});

// ----- 11. 服务层 resumeProject 已删除 -----

Deno.test({
  name: "t20 — ProjectService 不含 resumeProject 方法",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "backend/application/project/project.service.ts",
    );
    assertFalse(src.includes("resumeProject("), "resumeProject 已删除");
    assertFalse(
      src.includes('case "中止"'),
      "ProjectService.changeProjectStatus switch 不应再有 中止 case",
    );
  },
});

// ----- 12. AI 工具不含 resume_project -----

Deno.test({
  name: "t20 — writeable-tools 不含 resume_project；write_project_status 暂停必填 pausedDate",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "backend/ai/tool/builtin/writeable-tools.ts",
    );
    assertFalse(src.includes('name = "resume_project"'), "ResumeProjectTool 已删除");
    assertFalse(src.includes("class ResumeProjectTool"), "ResumeProjectTool 类已删除");
    // write_project_status 含 pausedDate 字段和校验
    assertStringIncludes(src, "args.pausedDate");
    assertStringIncludes(src, "pausedDate is required when transitioning to");
    assertFalse(src.includes("args.stopReason"));
    assertFalse(src.includes('args.status === "中止"'));
  },
});
