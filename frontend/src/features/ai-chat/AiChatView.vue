<!--
  AiChatView.vue
  ==============
  独立 AI 对话页（全屏）；抽屉模式在 AIChatDock 内。
  阶段 6.0f：挂载时拉项目列表给 @ autocomplete 用。
-->
<template>
  <section class="mx-auto flex h-full max-w-4xl flex-col p-6">
    <AiChatPanel />
  </section>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import AiChatPanel from "./AiChatPanel.vue";
import { projectApi } from "@frontend/features/project/api/project.api.ts";
import { useAiChatStore } from "./stores/ai-chat.store.ts";

const store = useAiChatStore();

onMounted(async () => {
  // 阶段 6.0f：拉项目列表当 @ autocomplete 候选
  try {
    const res = await projectApi.list({ limit: 200, offset: 0 });
    store.setMentionCandidates([...res.items]);
  } catch {
    // 静默失败 —— 候选池空了不影响基本对话
  }
});
</script>