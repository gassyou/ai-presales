<!--
  MessageBubble.vue
  =================
  对话消息气泡：用户 / 助手 / 系统 / 工具 不同风格
  阶段 5：assitant 消息下挂 ToolCallCard
-->
<template>
  <div :class="['flex', isUser ? 'justify-end' : 'justify-start']">
    <div
      :class="[
        'max-w-[85%] rounded-md px-3 py-2 text-sm leading-relaxed',
        isUser
          ? 'bg-accent/15 text-slate-900'
          : isTool
          ? 'border border-border bg-surface-alt/50 font-mono text-xs text-slate-700'
          : 'border border-border bg-white text-slate-800',
      ]"
    >
      <div v-if="message.role !== 'user'" class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
        {{ roleLabel }}
      </div>
      <div v-if="message.content" class="whitespace-pre-wrap break-words">{{ message.content }}</div>
      <div v-if="toolCalls.length > 0" class="mt-2 space-y-2">
        <ToolCallCard v-for="(tc, i) in toolCalls" :key="`${message.id}-tc-${i}`" :call="tc" />
      </div>
      <div class="mt-1 text-right text-[10px] text-slate-600">
        {{ formatTime(message.createdAt) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "./types.ts";
import ToolCallCard from "./ToolCallCard.vue";

const props = defineProps<{ message: ChatMessage }>();

const isUser = computed(() => props.message.role === "user");
const isTool = computed(() => props.message.role === "tool");
const toolCalls = computed(() => props.message.toolCalls ?? []);

const roleLabel = computed(() => {
  switch (props.message.role) {
    case "assistant":
      return "AI";
    case "system":
      return "系统";
    case "tool":
      return "工具";
    default:
      return props.message.role;
  }
});

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
</script>