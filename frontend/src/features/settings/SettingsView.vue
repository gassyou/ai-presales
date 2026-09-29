<!--
  SettingsView.vue —— 阶段 7.4h；阶段 7.7 加 Embedding tab；Element Plus 迁移版

  系统设置页：5 个 tab（Models / Embedding / Mail / Tools / Agents）。
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
      <el-button :disabled="loading" :loading="loading" @click="onReload">
        {{ loading ? "刷新中…" : "刷新" }}
      </el-button>
    </header>

    <el-tabs v-model="active">
      <el-tab-pane label="模型配置" name="llm">
        <LLMProfilesTab />
      </el-tab-pane>
      <el-tab-pane label="向量模型" name="embedding">
        <EmbeddingConfigTab />
      </el-tab-pane>
      <!-- 阶段 3：删除"工具配置" tab（用户原话"取消工具设置，默认所有 agent 都能访问系统工具"） -->
      <el-tab-pane label="邮件账号" name="mail">
        <MailAccountsTab />
      </el-tab-pane>
      <el-tab-pane label="Sub-agent" name="agents">
        <AgentSpecsTab />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "./stores/settings.store.ts";
import LLMProfilesTab from "./components/LLMProfilesTab.vue";
import EmbeddingConfigTab from "./components/EmbeddingConfigTab.vue";
import MailAccountsTab from "./components/MailAccountsTab.vue";
import AgentSpecsTab from "./components/AgentSpecsTab.vue";

const store = useSettingsStore();

type TabId = "llm" | "embedding" | "mail" | "tools" | "agents";
const active = ref<TabId>("llm");

const loading = computed(() => store.loading === "all");

onMounted(async () => {
  await store.loadAll();
});

async function onReload(): Promise<void> {
  await store.loadAll();
}
</script>