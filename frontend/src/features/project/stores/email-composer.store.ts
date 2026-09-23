/**
 * email-composer.store.ts —— 邮件撰写弹窗的全局开关
 *
 * 阶段 7.4e。由 WorkspaceShell 的浮动按钮打开，
 * 由 EmailComposerDialog 渲染（消费 store.open）。
 */

import { defineStore } from "pinia";
import { ref } from "vue";

export const useEmailComposerStore = defineStore("email-composer", () => {
  const open = ref(false);
  const projectId = ref<string | null>(null);

  function openComposer(pid: string): void {
    projectId.value = pid;
    open.value = true;
  }

  function close(): void {
    open.value = false;
  }

  return { open, projectId, openComposer, close };
});