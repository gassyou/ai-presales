/**
 * quoteComposerStore —— 报价单生成弹窗全局开关
 *
 * 阶段 7.4f：WorkspaceShell 浮动按钮 → store.openComposer(projectId) →
 * ProjectDetailView 内的 QuoteView 监听到后弹出 QuoteAiDraftDialog。
 */

import { defineStore } from "pinia";
import { ref } from "vue";

export const useQuoteComposerStore = defineStore("quote-composer", () => {
  const open = ref(false);
  const projectId = ref<string | null>(null);

  function openComposer(pid: string): void {
    projectId.value = pid;
    open.value = true;
  }
  function close(): void {
    open.value = false;
    projectId.value = null;
  }

  return { open, projectId, openComposer, close };
});