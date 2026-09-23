/**
 * ppt-page.ts 单元测试（阶段 7.4c）
 *
 * 覆盖：默认值 / 网格位置 / 校验 / snapshot 互转
 */

import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  GRID_COLS,
  GRID_STEP_X,
  GRID_STEP_Y,
  defaultPosition,
  makePptPage,
  pptPageToSnap,
  snapToPptPage,
  validatePptPagePatch,
  type PptPage,
} from "@backend/domain/business-module/ppt-page.ts";

const fakePid = "proj-1" as unknown as PptPage["projectId"];
const baseDate = new Date("2026-07-01T00:00:00Z");

Deno.test("ppt-page — makePptPage 直接构造", () => {
  const p = makePptPage({
    id: "p1",
    projectId: fakePid,
    ordinal: 0,
    title: "封面",
    prompt: "...",
    positionX: 10,
    positionY: 20,
    width: 220,
    height: 140,
    createdAt: baseDate,
    updatedAt: baseDate,
  });
  assertEquals(p.id, "p1");
  assertEquals(p.ordinal, 0);
  assertEquals(p.title, "封面");
  assertEquals(p.positionX, 10);
});

Deno.test("ppt-page — defaultPosition 网格布局", () => {
  // 第 1 张：左上角
  assertEquals(defaultPosition(0), { x: 0, y: 0 });
  // 第 4 张：第 1 行第 4 列
  assertEquals(defaultPosition(3), { x: 3 * GRID_STEP_X, y: 0 });
  // 第 5 张：第 2 行第 1 列
  assertEquals(defaultPosition(GRID_COLS), { x: 0, y: GRID_STEP_Y });
  // 第 8 张：第 2 行第 4 列
  assertEquals(defaultPosition(GRID_COLS + 3), { x: 3 * GRID_STEP_X, y: GRID_STEP_Y });
});

Deno.test("ppt-page — defaultPosition 步长与默认值一致", () => {
  // x 步长应等于 width + gap
  assert(GRID_STEP_X > DEFAULT_WIDTH);
  assert(GRID_STEP_Y > DEFAULT_HEIGHT);
});

Deno.test("ppt-page — validatePptPagePatch 边界", () => {
  // 全部正常 → null
  assertEquals(validatePptPagePatch({ title: "x", prompt: "y" }), null);

  // 空 title → 错
  assert(validatePptPagePatch({ title: "   " }) !== null);

  // 空 prompt → 允许（用于清空 PATCH）
  assertEquals(validatePptPagePatch({ prompt: "" }), null);
  assertEquals(validatePptPagePatch({ prompt: "   " }), null);

  // 标题过长 → 错
  assert(validatePptPagePatch({ title: "x".repeat(201) }) !== null);

  // 提示词过长 → 错
  assert(validatePptPagePatch({ prompt: "x".repeat(8001) }) !== null);

  // ordinal < 0 → 错
  assert(validatePptPagePatch({ ordinal: -1 }) !== null);

  // positionX < 0 → 错
  assert(validatePptPagePatch({ positionX: -1 }) !== null);

  // width <= 0 → 错
  assert(validatePptPagePatch({ width: 0 }) !== null);
  assert(validatePptPagePatch({ width: -5 }) !== null);
});

Deno.test("ppt-page — snapToPptPage 与 pptPageToSnap 互转", () => {
  const orig: PptPage = makePptPage({
    id: "p1",
    projectId: fakePid,
    ordinal: 3,
    title: "痛点分析",
    prompt: "...",
    positionX: 0,
    positionY: 156,
    width: 220,
    height: 140,
    createdAt: baseDate,
    updatedAt: baseDate,
  });
  const snap = pptPageToSnap(orig);
  assertEquals(typeof snap.createdAt, "string");
  assertEquals(snap.ordinal, 3);

  const back = snapToPptPage(snap);
  assertEquals(back.id, "p1");
  assertEquals(back.createdAt.toISOString(), baseDate.toISOString());
  assertEquals(back.ordinal, 3);
});