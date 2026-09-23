/**
 * PptPage —— 提案 PPT 单页便签
 *
 * 阶段 7.4c：每页 PPT 一行存储；prompt 是该页的 AI 提示词。
 *
 * 与 business_module_items / budget_summary 的区别：
 *   - 高频读 + 流式写（AI 逐页生成）
 *   - ordinal / positionX / positionY 是稳定列，需要独立索引
 *   - 不复用通用 CRUD；走专用路由
 *
 * 形态：
 *   - ordinal：0-based；用于排序/导出
 *   - positionX/Y：画布坐标（默认网格布局；index → (col=i%4, row=i/4)）
 *   - width/height：便签尺寸（默认 220×140）
 */

import type { ProjectId } from "@shared/types/ids.ts";

/** 便签默认尺寸 */
export const DEFAULT_WIDTH = 220;
export const DEFAULT_HEIGHT = 140;
/** 网格列数（用于 defaultPosition 网格化布局） */
export const GRID_COLS = 4;
/** 网格步长（x/y 像素间距） */
export const GRID_STEP_X = DEFAULT_WIDTH + 16;
export const GRID_STEP_Y = DEFAULT_HEIGHT + 16;

export interface PptPage {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly ordinal: number;
  readonly title: string;
  readonly prompt: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PptPageSnapshot extends Omit<PptPage, "createdAt" | "updatedAt"> {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PptPagePatch {
  readonly ordinal?: number;
  readonly title?: string;
  readonly prompt?: string;
  readonly positionX?: number;
  readonly positionY?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface MakePptPageSeed {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly ordinal: number;
  readonly title: string;
  readonly prompt: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 工厂：传入 seed 直接构造（不做校验；用于仓储 / 测试） */
export function makePptPage(seed: MakePptPageSeed): PptPage {
  return {
    id: seed.id,
    projectId: seed.projectId,
    ordinal: seed.ordinal,
    title: seed.title,
    prompt: seed.prompt,
    positionX: seed.positionX,
    positionY: seed.positionY,
    width: seed.width,
    height: seed.height,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
  };
}

/** 默认网格位置：index → (col=i%4, row=i/4) */
export function defaultPosition(index: number): { x: number; y: number } {
  const col = ((index % GRID_COLS) + GRID_COLS) % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  return { x: col * GRID_STEP_X, y: row * GRID_STEP_Y };
}

/** 域校验：失败时返回错误信息；成功返回 null */
export function validatePptPagePatch(p: PptPagePatch): string | null {
  if (p.title !== undefined && p.title.trim().length === 0) {
    return "title 不能为空";
  }
  if (p.title !== undefined && p.title.length > 200) {
    return "title too long (max 200)";
  }
  if (p.prompt !== undefined && p.prompt.length > 8000) {
    return "prompt too long (max 8000)";
  }
  if (p.ordinal !== undefined && p.ordinal < 0) {
    return "ordinal 必须 ≥ 0";
  }
  if (p.positionX !== undefined && p.positionX < 0) {
    return "positionX 必须 ≥ 0";
  }
  if (p.positionY !== undefined && p.positionY < 0) {
    return "positionY 必须 ≥ 0";
  }
  if (p.width !== undefined && p.width <= 0) {
    return "width 必须 > 0";
  }
  if (p.height !== undefined && p.height <= 0) {
    return "height 必须 > 0";
  }
  return null;
}

/** Snapshot ↔ Domain 互转（仓储层使用） */
export function snapToPptPage(snap: PptPageSnapshot): PptPage {
  return {
    id: snap.id,
    projectId: snap.projectId,
    ordinal: snap.ordinal,
    title: snap.title,
    prompt: snap.prompt,
    positionX: snap.positionX,
    positionY: snap.positionY,
    width: snap.width,
    height: snap.height,
    createdAt: new Date(snap.createdAt),
    updatedAt: new Date(snap.updatedAt),
  };
}

export function pptPageToSnap(p: PptPage): PptPageSnapshot {
  return {
    id: p.id,
    projectId: p.projectId,
    ordinal: p.ordinal,
    title: p.title,
    prompt: p.prompt,
    positionX: p.positionX,
    positionY: p.positionY,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}