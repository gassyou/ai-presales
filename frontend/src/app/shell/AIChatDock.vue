<!--
  AIChatDock.vue
  ==============
  工作台右侧 AI 抽屉（浅色商务风）
  - 父容器（WorkspaceShell 通过 ResizableSplit）已控制宽度；
    折叠态由 ResizableSplit 的 collapsed 控制，本组件不直接管理 open。
  - 折叠按钮：触发 "折叠"，由父级设 collapsed=true。
  - Header：AI 助手标识 + 绑定/全局徽章 + sub-agent 选择 + 清空 + 折叠。
    模型选择（profile）已搬到 ChatComposer 底部输入卡片。
-->
<template>
  <aside
    class="flex h-full w-full min-h-0 flex-col border-border bg-white"
    :class="side === 'right' ? 'border-l' : 'border-r'"
  >
    <!-- Header -->
    <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-sm">
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full bg-accent" />
        <span class="font-medium text-slate-800">AI 助手</span>
        <span
          v-if="store.currentProject"
          class="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-emerald-700"
          :title="`项目 ${store.currentProject.code}`"
        >
          绑定：{{ store.currentProject.code }}
        </span>
        <span v-else class="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-500">
          全局对话
        </span>
      </div>

      <div class="flex items-center gap-2">
        <el-button
          size="small"
          @click="store.clear"
        >
          清空
        </el-button>
        <el-button
          link
          size="small"
          title="折叠"
          @click="$emit('collapse')"
        >
          ›
        </el-button>
      </div>
    </div>

    <AiChatPanel class="flex-1 min-h-0" />
  </aside>
</template>

<script setup lang="ts">
import AiChatPanel from "@frontend/features/ai-chat/AiChatPanel.vue";
import { useAiChatStore } from "@frontend/features/ai-chat/stores/ai-chat.store.ts";

defineProps<{ side?: "left" | "right" }>();
defineEmits<{ (e: "collapse"): void }>();

const store = useAiChatStore();
</script>