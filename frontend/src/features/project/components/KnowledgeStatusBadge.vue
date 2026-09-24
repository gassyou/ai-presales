<!--
  KnowledgeStatusBadge.vue
  ========================
  项目知识库状态徽章 + 标题区复用的紧凑按钮。
  - 显示：`已入库 N块` 或 `未入库` + 上次入库相对时间
  - 点击调 store.ingest(projectId)；ingesting 态禁用
  - 仅渲染一个徽章 + 一个按钮（无卡片、无标题、无冗余文字）
-->
<template>
  <div class="flex items-center gap-2">
    <span class="text-[11px] text-slate-500">知识库</span>
    <span
      v-if="status"
      :class="status.isIndexed
        ? 'rounded bg-accent-soft px-1.5 py-0.5 text-xs text-emerald-700'
        : 'rounded bg-surface-alt px-1.5 py-0.5 text-xs text-slate-500'"
    >
      {{ status.isIndexed ? `已入库 ${status.chunkCount ?? 0} 块` : "未入库" }}
    </span>
    <span v-if="status?.lastIngestedAt" class="text-[11px] text-slate-500">
      {{ formatRelative(status.lastIngestedAt) }}
    </span>
    <button
      class="rounded border px-3 py-1.5 text-xs"
      :class="store.ingesting === projectId
        ? 'cursor-not-allowed border-border text-slate-500'
        : 'border-accent/50 text-accent hover:bg-accent/10'"
      :disabled="store.ingesting === projectId"
      @click="onIngest"
    >
      {{ store.ingesting === projectId ? "入库中…" : status?.isIndexed ? "重新入库" : "加入知识库" }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useKnowledgeStore } from "../stores/knowledge.store.ts";

const props = defineProps<{ projectId: string }>();
const store = useKnowledgeStore();

const status = computed(() => store.getStatus(props.projectId));

async function onIngest(): Promise<void> {
  await store.ingest(props.projectId);
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