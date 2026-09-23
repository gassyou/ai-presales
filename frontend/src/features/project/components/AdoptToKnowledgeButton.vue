<!--
  AdoptToKnowledgeButton.vue
  ==========================
  阶段 6.0g：「加入知识库」按钮
  - 显示当前项目知识库状态（已入库 / 未入库 + chunkCount）
  - 点击后调 ingest；loading 态；完成后自动 refresh status
  - 用 store 缓存避免重复请求
-->
<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2 text-xs">
      <span
        :class="statusBadgeClass"
        class="rounded px-1.5 py-0.5"
      >
        {{ statusLabel }}
      </span>
      <span v-if="status?.lastIngestedAt" class="text-slate-500">
        上次：{{ formatRelative(status.lastIngestedAt) }}
      </span>
      <span v-else-if="status?.messageCount" class="text-slate-500">
        {{ status.messageCount }} 条消息待入库
      </span>
    </div>

    <button
      class="self-start rounded border px-3 py-1.5 text-xs"
      :class="buttonClass"
      :disabled="store.ingesting === projectId"
      @click="onClick"
    >
      <span v-if="store.ingesting === projectId">入库中…</span>
      <span v-else-if="status?.isIndexed">重新入库</span>
      <span v-else>加入知识库</span>
    </button>

    <p v-if="resultMessage" class="text-xs text-slate-600">{{ resultMessage }}</p>
    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useKnowledgeStore } from "../stores/knowledge.store.ts";

const props = defineProps<{ projectId: string }>();
const store = useKnowledgeStore();

const status = computed(() => store.getStatus(props.projectId));
const resultMessage = ref<string | null>(null);

const statusBadgeClass = computed(() =>
  status.value?.isIndexed
    ? "bg-accent-soft text-emerald-700"
    : "bg-surface-alt text-slate-500"
);

const statusLabel = computed(() => {
  if (!status.value) return "加载中…";
  if (status.value.isIndexed) {
    return `已入库（${status.value.chunkCount} 块）`;
  }
  return "未入库";
});

const buttonClass = computed(() =>
  store.ingesting === props.projectId
    ? "border-border text-slate-500 cursor-not-allowed"
    : status.value?.isIndexed
      ? "border-border text-slate-700 hover:bg-surface-alt"
      : "border-accent/50 text-accent hover:bg-accent/10"
);

async function onClick(): Promise<void> {
  resultMessage.value = null;
  const r = await store.ingest(props.projectId);
  if (r) {
    resultMessage.value = `已处理 ${r.scanned} 条消息：入库 ${r.indexed} / 跳过 ${r.skipped}，写入 ${r.totalChunks} 块（${r.elapsedMs}ms）`;
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - t);
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

onMounted(() => {
  if (!status.value) void store.loadStatus(props.projectId);
});

watch(
  () => props.projectId,
  (id) => {
    if (id && !status.value) void store.loadStatus(id);
  },
);
</script>