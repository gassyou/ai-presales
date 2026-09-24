<!--
  KnowledgeStatusBadge.vue
  ========================
  项目知识库状态徽章 + 顶部按钮区的紧凑按钮。
  - 显示：`已入库 N块` 或 `未入库` + 上次入库相对时间
  - 点击调 store.ingest(projectId)；ingesting 态禁用
  - 仅渲染一个徽章 + 一个按钮
  - 风格：主色背景填充（与「生成报价单 / 发送邮件」保持高度一致）
-->
<template>
  <div class="flex items-center gap-2">
    <span
      v-if="status"
      :class="status.isIndexed
        ? 'rounded bg-accent-soft px-2 py-1 text-xs text-emerald-700'
        : 'rounded bg-slate-100 px-2 py-1 text-xs text-slate-600'"
    >
      {{ status.isIndexed ? `已入库 ${status.chunkCount ?? 0} 块` : "未入库" }}
    </span>
    <span v-if="status?.lastIngestedAt" class="text-[11px] text-slate-500">
      · {{ formatRelative(status.lastIngestedAt) }}
    </span>
    <button
      type="button"
      class="inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition"
      :class="store.ingesting === projectId
        ? 'cursor-not-allowed bg-emerald-400 text-white'
        : status?.isIndexed
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'bg-emerald-600 text-white hover:bg-emerald-700'"
      :disabled="store.ingesting === projectId"
      @click="onIngest"
    >
      <span>{{ store.ingesting === projectId ? "入库中…" : status?.isIndexed ? "重新入库" : "加入知识库" }}</span>
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
