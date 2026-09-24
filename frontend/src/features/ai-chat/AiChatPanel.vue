<!--
  AiChatPanel.vue
  ===============
  AI 对话面板：消息列表 + 输入卡片。
  阶段 4：SSE 流式。
  阶段 5：sub-agent 选择器；tool_call/tool_result 渲染为 ToolCallCard。
  阶段 6.0f：项目绑定徽章；@ 项目名 自动补全；mention 高亮渲染。
  阶段重构：输入区移到独立组件 ChatComposer.vue（Claude 风格卡片）。
-->
<template>
  <section class="flex h-full flex-col">
    <div ref="scrollRef" class="flex-1 space-y-2 px-4 py-3 overflow-y-auto">
      <div v-if="store.messages.length === 0" class="text-center text-xs text-slate-500">
        <p v-if="store.currentProject">
          当前项目 <code>{{ store.currentProject.code }}</code>。<br />
          输入 <code>@</code> 可引用其他项目。
        </p>
        <p v-else>试着问点什么。例："请帮我总结一个 ERP 升级提案的概要"。</p>
      </div>
      <MessageBubble v-for="m in store.messages" :key="m.id" :message="m" />

      <div v-if="store.loading" class="flex justify-start">
        <div class="max-w-[85%] rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-600">
          AI 思考中…
        </div>
      </div>
    </div>

    <div v-if="store.error" class="border-t border-red-800 bg-red-900/20 px-4 py-2 text-xs text-red-300">
      {{ store.error }}
    </div>

    <ChatComposer />
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useAiChatStore } from "./stores/ai-chat.store.ts";
import MessageBubble from "./MessageBubble.vue";
import ChatComposer from "./ChatComposer.vue";

const store = useAiChatStore();
const scrollRef = ref<HTMLElement | null>(null);

watch(
  () => store.messages.length,
  () => {
    void nextTick(() => {
      if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    });
  },
);
</script>