<!--
  AIChatDock.vue
  ==============
  工作台右侧 AI 抽屉（浅色商务风）
  - 父容器（WorkspaceShell 通过 ResizableSplit）已控制宽度；
    折叠态由 ResizableSplit 的 collapsed 控制，本组件不直接管理 open。
  - 折叠按钮：触发 "折叠"，由父级设 collapsed=true。
-->
<template>
  <aside
    class="flex h-full w-full min-h-0 flex-col border-border bg-white"
    :class="side === 'right' ? 'border-l' : 'border-r'"
  >
    <!-- Header -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
      <div class="flex items-center gap-1.5 text-sm font-medium text-slate-800">
        <span class="h-2 w-2 rounded-full bg-accent" />
        AI 助手
      </div>
      <button
        class="btn-ghost btn !px-1.5 !py-0.5 text-xs"
        title="折叠"
        @click="$emit('collapse')"
      >
        ›
      </button>
    </div>
    <AiChatPanel class="flex-1 min-h-0" />
  </aside>
</template>

<script setup lang="ts">
import AiChatPanel from "@frontend/features/ai-chat/AiChatPanel.vue";

defineProps<{ side?: "left" | "right" }>();
defineEmits<{ (e: "collapse"): void }>();
</script>