/**
 * PPT 页面布局常量（前后端共享）
 *
 * 这些数字必须与后端 `backend/domain/business-module/ppt-page.ts` 中的
 * `defaultPosition(index)` 保持一致 —— 前端在拿到流式 `ppt_page` 事件、
 * 本地为新页铺默认坐标时使用。
 *
 * 若调整后端默认值，前端也需同步修改。
 */

export const PPT_DEFAULT_WIDTH = 220;
export const PPT_DEFAULT_HEIGHT = 140;
/** 网格列数（与后端 GRID_COLS 同步） */
export const PPT_GRID_COLS = 4;
/** 横向步长 = DEFAULT_WIDTH + 16px 间距 = 236 */
export const PPT_GRID_STEP_X = PPT_DEFAULT_WIDTH + 16;
/** 纵向步长 = DEFAULT_HEIGHT + 16px 间距 = 156 */
export const PPT_GRID_STEP_Y = PPT_DEFAULT_HEIGHT + 16;

/** 第 index 张便签的默认坐标（index → (col=i%4, row=i/4)） */
export function defaultPptPosition(index: number): { x: number; y: number } {
  const col = ((index % PPT_GRID_COLS) + PPT_GRID_COLS) % PPT_GRID_COLS;
  const row = Math.floor(index / PPT_GRID_COLS);
  return { x: col * PPT_GRID_STEP_X, y: row * PPT_GRID_STEP_Y };
}