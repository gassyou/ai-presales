<!--
  WorkspaceShell.vue
  ==================
  工作台壳（浅色商务风 + VSCode 风格可拖动面板）

  布局：
    ┌─────────────────────────────────────────────────┐
    │             TopBar（h-10，白底细边框）            │
    ├────────────────────────────────────┬────────────┤
    │                                    │            │
    │       主区（router-view）          │  AI 抽屉  │
    │       #fafafa                      │  白底     │
    │                                    │  ↕       │
    │       弹性 flex-1                  │  360     │
    └────────────────────────────────────┴────────────┘

  仅右侧 <ResizableSplit>：
    - 鼠标拖分隔条调宽度
    - 双击分隔条恢复默认
    - 键盘 Tab → ← → / Home / End / Enter
    - localStorage 持久化（键 ui.shell.rightDock）

  阶段 7.4e/7.4f：项目详情页浮动按钮触发 EmailComposerDialog / QuoteAiDraftDialog。

  阶段重构：菜单项搬入 TopBar；启动时拉一次项目列表用于 @ mention 候选池。
-->
<template>
  <div class="flex h-full flex-col bg-canvas-subtle text-slate-900">
    <TopBar />
    <div class="flex min-h-0 flex-1">
      <main class="flex-1 min-w-0 overflow-auto bg-canvas-subtle">
        <router-view />
      </main>

      <ResizableSplit
        side="right"
        :width="rightWidth"
        :min="RIGHT_MIN"
        :max="RIGHT_MAX"
        :default-width="RIGHT_DEFAULT"
        storage-key="ui.shell.rightDock"
        :collapsed="dockCollapsed"
        @update:width="rightWidth = $event"
        @update:collapsed="dockCollapsed = $event"
      >
        <AIChatDock @collapse="dockCollapsed = true" />
      </ResizableSplit>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import TopBar from "./TopBar.vue";
import AIChatDock from "./AIChatDock.vue";
import ResizableSplit from "@frontend/shared/ui/ResizableSplit.vue";
import { useResizableWidth } from "@frontend/shared/utils/use-resizable-width.ts";
import { projectApi } from "@frontend/features/project/api/project.api.ts";
import { useAiChatStore } from "@frontend/features/ai-chat/stores/ai-chat.store.ts";

const route = useRoute();
const aiChatStore = useAiChatStore();

// 右侧 AI 抽屉宽度
const RIGHT_DEFAULT = 360;
const RIGHT_MIN = 240;
const RIGHT_MAX = 600;
const rightResize = useResizableWidth({
  storageKey: "ui.shell.rightDock",
  defaultWidth: RIGHT_DEFAULT,
  min: RIGHT_MIN,
  max: RIGHT_MAX,
});
const rightWidth = rightResize.width;

// 折叠状态单独存（不持久化：每次启动默认展开）
const dockCollapsed = ref(false);

// 启动时拉一次项目列表 → @ mention 候选池（dock 与未来任何用 panel 的视图共享）
onMounted(async () => {
  try {
    const res = await projectApi.list({ limit: 200, offset: 0 });
    aiChatStore.setMentionCandidates([...res.items]);
  } catch {
    // 静默失败 —— 候选池空了不影响基本对话
  }
});
</script>