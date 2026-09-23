<!--
  SettingsView.vue —— 阶段 7.4h；阶段 7.7 加 Embedding tab

  系统设置页：5 个 tab（Models / Embedding / Mail / Tools / Agents）。
  - 进入页面时 loadAll() 一次性拉全集
  - 每个 tab 独立保存（不同 store slice）
  - 顶栏小字提示"明文存储，仅限本机单用户场景"
-->
<template>
  <div class="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-medium text-slate-900">系统设置</h1>
        <p class="text-xs text-slate-500">
          API key / SMTP 密码以明文存于本地 SQLite（仅适合本机单用户场景）。
          改完保存后即时生效，无需重启服务。
        </p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="onReload">
        {{ loading ? "刷新中…" : "刷新" }}
      </button>
    </header>

    <nav class="flex gap-1 border-b border-border">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="rounded-t px-4 py-2 text-xs transition-colors"
        :class="active === t.id
          ? 'border-b-2 border-accent text-accent'
          : 'text-slate-600 hover:text-slate-800'"
        @click="active = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <LLMProfilesTab v-if="active === 'llm'" />
    <EmbeddingConfigTab v-else-if="active === 'embedding'" />
    <MailAccountsTab v-else-if="active === 'mail'" />
    <ToolConfigsTab v-else-if="active === 'tools'" />
    <AgentSpecsTab v-else-if="active === 'agents'" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "./stores/settings.store.ts";
import LLMProfilesTab from "./components/LLMProfilesTab.vue";
import EmbeddingConfigTab from "./components/EmbeddingConfigTab.vue";
import MailAccountsTab from "./components/MailAccountsTab.vue";
import ToolConfigsTab from "./components/ToolConfigsTab.vue";
import AgentSpecsTab from "./components/AgentSpecsTab.vue";

const store = useSettingsStore();

const tabs = [
  { id: "llm", label: "模型配置" },
  { id: "embedding", label: "向量模型" },
  { id: "mail", label: "邮件账号" },
  { id: "tools", label: "工具配置" },
  { id: "agents", label: "Sub-agent" },
] as const;

type TabId = typeof tabs[number]["id"];
const active = ref<TabId>("llm");

const loading = computed(() => store.loading === "all");

onMounted(async () => {
  await store.loadAll();
});

async function onReload(): Promise<void> {
  await store.loadAll();
}
</script>