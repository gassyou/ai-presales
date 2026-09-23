<!--
  WorkspaceShell.vue
  ==================
  工作台壳（浅色商务风 + VSCode 风格可拖动面板）

  布局：
    ┌─────────────────────────────────────────────────┐
    │               TopBar（h-10，白底细边框）         │
    ├──────┬───────────────────────────────┬──────────┤
    │ 左   │                               │ 右       │
    │ 侧   │         主区（router-view）    │ AI 抽屉 │
    │ 栏  │          白底                  │ 白底   │
    │ ↕  │                               │ ↕     │
    │ 240 │          弹性 flex-1           │ 360   │
    └──────┴───────────────────────────────┴──────────┘

  左 / 右各一个 <ResizableSplit>：
    - 鼠标拖分隔条调宽度
    - 双击分隔条恢复默认
    - 键盘 Tab → ← → / Home / End / Enter
    - localStorage 持久化（键 ui.shell.leftNav / ui.shell.rightDock）

  阶段 7.4e/7.4f：项目详情页浮动按钮触发 EmailComposerDialog / QuoteAiDraftDialog。
-->
<template>
  <div class="flex h-full flex-col bg-canvas-subtle text-slate-900">
    <TopBar />
    <div class="flex min-h-0 flex-1">
      <ResizableSplit
        side="left"
        :width="leftWidth"
        :min="LEFT_MIN"
        :max="LEFT_MAX"
        :default-width="LEFT_DEFAULT"
        storage-key="ui.shell.leftNav"
        @update:width="leftWidth = $event"
      >
        <SideNav />
      </ResizableSplit>

      <main class="flex-1 min-w-0 overflow-auto bg-white">
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

    <!-- 浮动按钮（仅项目详情页可见） -->
    <div
      v-if="showProjectActions"
      class="fixed bottom-6 right-6 z-40 flex flex-col gap-2"
    >
      <button
        class="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-pop hover:bg-emerald-700"
        @click="openQuote"
      >
        ⊕ 生成报价单
      </button>
      <button
        class="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-pop hover:bg-accent-subtle"
        @click="openComposer"
      >
        ✉ 发送邮件
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import TopBar from "./TopBar.vue";
import SideNav from "./SideNav.vue";
import AIChatDock from "./AIChatDock.vue";
import ResizableSplit from "@frontend/shared/ui/ResizableSplit.vue";
import { useResizableWidth } from "@frontend/shared/utils/use-resizable-width.ts";
import { useEmailComposerStore } from "@frontend/features/project/stores/email-composer.store.ts";
import { useQuoteComposerStore } from "@frontend/features/quote/stores/quote-composer.store.ts";

const route = useRoute();
const emailComposerStore = useEmailComposerStore();
const quoteComposerStore = useQuoteComposerStore();

const showProjectActions = computed(() => route.name === "project-detail");

// 左侧导航栏宽度（VSCode 风）
const LEFT_DEFAULT = 240;
const LEFT_MIN = 180;
const LEFT_MAX = 400;
const leftResize = useResizableWidth({
  storageKey: "ui.shell.leftNav",
  defaultWidth: LEFT_DEFAULT,
  min: LEFT_MIN,
  max: LEFT_MAX,
});
const leftWidth = leftResize.width;

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

function projectIdFromRoute(): string | null {
  const id = route.params.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function openComposer(): void {
  const id = projectIdFromRoute();
  if (!id) return;
  emailComposerStore.openComposer(id);
}

function openQuote(): void {
  const id = projectIdFromRoute();
  if (!id) return;
  quoteComposerStore.openComposer(id);
}
</script>