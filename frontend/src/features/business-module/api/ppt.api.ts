/**
 * PPT API —— 提案 PPT 设计（阶段 7.4c）
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { postSse, readSse } from "@frontend/shared/api/sse-client.ts";
import type { StreamEvent } from "@shared/types/dto/ai-session.ts";

export interface PptPageDTO {
  id: string;
  projectId: string;
  ordinal: number;
  title: string;
  prompt: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export interface PptPageInput {
  title: string;
  prompt?: string;
  ordinal?: number;
  positionX?: number;
  positionY?: number;
}

export interface PptPagePatch {
  ordinal?: number;
  title?: string;
  prompt?: string;
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
}

export const pptApi = {
  /** 列表 */
  list(projectId: string) {
    return http.get<{ items: PptPageDTO[] }>(`/api/projects/${projectId}/ppt/pages`);
  },
  /** 新建 */
  create(projectId: string, input: PptPageInput) {
    return http.post<PptPageDTO>(`/api/projects/${projectId}/ppt/pages`, input);
  },
  /** 更新（按 id） */
  update(id: string, patch: PptPagePatch) {
    return http.patch<PptPageDTO>(`/api/modules/ppt/pages/${id}`, patch);
  },
  /** 删除 */
  delete(id: string) {
    return http.del<void>(`/api/modules/ppt/pages/${id}`);
  },
  /** 拖拽排序 */
  reorder(projectId: string, ids: string[]) {
    return http.post<{ ok: boolean }>(`/api/projects/${projectId}/ppt/pages/reorder`, { ids });
  },
  /** 导出 Markdown */
  exportMarkdown(projectId: string) {
    return http.get<{ markdown: string }>(`/api/projects/${projectId}/ppt/pages/export`);
  },
  /** AI 流式生成（SSE） */
  async *generateStream(
    projectId: string,
    userInput: string,
    opts: { profile?: string; signal?: AbortSignal } = {},
  ): AsyncIterable<StreamEvent> {
    const res = await postSse(
      `/api/projects/${projectId}/ppt/pages/generate`,
      { userInput, ...(opts.profile ? { profile: opts.profile } : {}) },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    yield* readSse(res, opts.signal);
  },
};