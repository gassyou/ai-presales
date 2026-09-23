/**
 * PPT Store —— 提案 PPT 设计 Pinia store
 *
 * 阶段 7.4c。
 *
 *  - pagesByProject: Map<projectId, PptPageDTO[]>（已排序 by ordinal asc）
 *  - 暴露 generateStream：消费 SSE → 把 ppt_page 事件喂进列表
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { pptApi, type PptPageDTO, type PptPageInput, type PptPagePatch } from "../api/ppt.api.ts";
import type { StreamEvent } from "@shared/types/dto/ai-session.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import {
  defaultPptPosition,
  PPT_DEFAULT_HEIGHT,
  PPT_DEFAULT_WIDTH,
} from "@shared/types/ppt-constants.ts";

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error
    ? e.message
    : String(e);
}

export const usePptStore = defineStore("ppt", () => {
  const pagesByProject = ref<Map<string, PptPageDTO[]>>(new Map());
  const generating = ref<string | null>(null); // 当前正在生成的项目 id
  const error = ref<string | null>(null);
  /** 最近一次流式 done 的 messageId（用于 UI 提示） */
  const lastMessageId = ref<string | null>(null);

  function sortAndSet(projectId: string, pages: PptPageDTO[]): void {
    const sorted = [...pages].sort((a, b) => a.ordinal - b.ordinal);
    pagesByProject.value.set(projectId, sorted);
    pagesByProject.value = new Map(pagesByProject.value);
  }

  async function load(projectId: string): Promise<void> {
    try {
      const r = await pptApi.list(projectId);
      sortAndSet(projectId, r.items);
      error.value = null;
    } catch (e) {
      error.value = errMsg(e);
    }
  }

  function getList(projectId: string): PptPageDTO[] {
    return pagesByProject.value.get(projectId) ?? [];
  }

  async function create(
    projectId: string,
    input: PptPageInput,
  ): Promise<PptPageDTO | null> {
    try {
      const it = await pptApi.create(projectId, input);
      const cur = pagesByProject.value.get(projectId) ?? [];
      sortAndSet(projectId, [...cur, it]);
      return it;
    } catch (e) {
      error.value = errMsg(e);
      return null;
    }
  }

  async function update(
    projectId: string,
    id: string,
    patch: PptPagePatch,
  ): Promise<PptPageDTO | null> {
    try {
      const it = await pptApi.update(id, patch);
      const cur = pagesByProject.value.get(projectId) ?? [];
      const idx = cur.findIndex((p) => p.id === id);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = it;
        sortAndSet(projectId, next);
      }
      return it;
    } catch (e) {
      error.value = errMsg(e);
      return null;
    }
  }

  async function deletePage(projectId: string, id: string): Promise<boolean> {
    try {
      await pptApi.delete(id);
      const cur = pagesByProject.value.get(projectId) ?? [];
      sortAndSet(projectId, cur.filter((p) => p.id !== id));
      return true;
    } catch (e) {
      error.value = errMsg(e);
      return false;
    }
  }

  async function reorder(projectId: string, orderedIds: string[]): Promise<void> {
    const cur = pagesByProject.value.get(projectId) ?? [];
    // 防御：orderedIds 必须与当前列表长度一致（draggable 在元素数变化时可能给旧序列）
    if (orderedIds.length !== cur.length) {
      error.value = `ppt reorder: id count mismatch (got ${orderedIds.length}, have ${cur.length})`;
      return;
    }
    // no-op 检测：序列完全相同则不发请求
    const sameOrder = cur.every((p, i) => p.id === orderedIds[i]);
    if (sameOrder) return;
    const map = new Map(cur.map((p) => [p.id, p]));
    const next: PptPageDTO[] = orderedIds
      .map((id, i) => {
        const p = map.get(id);
        if (!p) return null;
        return { ...p, ordinal: i };
      })
      .filter((p): p is PptPageDTO => p !== null);
    if (next.length !== cur.length) {
      error.value = "ppt reorder: some ids not in current list";
      return;
    }
    sortAndSet(projectId, next);
    try {
      await pptApi.reorder(projectId, orderedIds);
    } catch (e) {
      error.value = errMsg(e);
      // 回滚：重新拉
      await load(projectId);
    }
  }

  async function exportMarkdown(projectId: string): Promise<string | null> {
    try {
      const r = await pptApi.exportMarkdown(projectId);
      return r.markdown;
    } catch (e) {
      error.value = errMsg(e);
      return null;
    }
  }

  function applyStreamEvent(projectId: string, ev: StreamEvent): void {
    if (ev.type === "ppt_page") {
      const cur = pagesByProject.value.get(projectId) ?? [];
      const idx = cur.findIndex((p) => p.id === ev.pageId);
      // 新增页：铺默认网格坐标 + 排序键
      if (idx < 0) {
        const pos = defaultPptPosition(ev.ordinal);
        const dto: PptPageDTO = {
          id: ev.pageId,
          projectId,
          ordinal: ev.ordinal,
          title: ev.title,
          prompt: ev.prompt,
          positionX: pos.x,
          positionY: pos.y,
          width: PPT_DEFAULT_WIDTH,
          height: PPT_DEFAULT_HEIGHT,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        sortAndSet(projectId, [...cur, dto]);
      } else {
        // 已有页：仅刷新标题/正文/ordinal，不动用户拖过的坐标
        const next = [...cur];
        const existing = next[idx];
        if (existing) {
          next[idx] = {
            ...existing,
            ordinal: ev.ordinal,
            title: ev.title,
            prompt: ev.prompt,
            updatedAt: new Date().toISOString(),
          };
        }
        sortAndSet(projectId, next);
      }
    } else if (ev.type === "done") {
      lastMessageId.value = ev.messageId;
      generating.value = null;
    } else if (ev.type === "error") {
      error.value = `${ev.code}: ${ev.message}`;
      generating.value = null;
    }
  }

  async function generateStream(
    projectId: string,
    userInput: string,
    opts: { profile?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    error.value = null;
    generating.value = projectId;
    try {
      for await (const ev of pptApi.generateStream(projectId, userInput, opts)) {
        applyStreamEvent(projectId, ev);
      }
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      generating.value = null;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    pagesByProject,
    generating,
    error,
    lastMessageId,
    load,
    getList,
    create,
    update,
    deletePage,
    reorder,
    exportMarkdown,
    generateStream,
    applyStreamEvent,
    clearError,
  };
});