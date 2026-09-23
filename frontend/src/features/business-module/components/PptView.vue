<!--
  PptView.vue
  ==========
  提案 PPT 设计容器（阶段 7.4c）。

  形态：
    - 顶部：AI 生成 / 新增便签 / 导出 Markdown 三个按钮
    - 中部：便签网格（vuedraggable 实现拖拽排序）
    - 空态：引导文案
    - PptAiGenerateDialog 弹窗
-->
<template>
  <section class="flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">提案 PPT 设计（{{ pages.length }} 页）</h2>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
          @click="openAi"
        >AI 生成</button>
        <button
          class="rounded border border-border px-2 py-1 text-xs text-slate-700 hover:bg-surface-alt"
          @click="onCreate"
        >新增便签</button>
        <button
          class="rounded border border-border px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt"
          @click="onExport"
        >导出 Markdown</button>
      </div>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>

    <div v-if="pages.length === 0" class="rounded border border-border bg-white/50 p-6 text-center text-xs text-slate-600">
      暂无 PPT 页。点击「AI 生成」让 AI 设计 8~15 页提案 PPT，或「新增便签」手工创建。
    </div>

    <div v-else class="rounded border border-border bg-white/30 p-3">
      <draggable
        :model-value="pages"
        @update:model-value="onDragEnd"
        item-key="id"
        :animation="150"
        ghost-class="opacity-40"
        handle=".drag-handle"
        class="flex flex-wrap gap-3"
      >
        <template #item="{ element }">
          <PptNote
            :page="element"
            @update="onUpdate"
            @delete="onDelete"
          />
        </template>
      </draggable>
    </div>

    <PptAiGenerateDialog
      v-if="aiOpen"
      :project-id="projectId"
      @close="aiOpen = false"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import draggable from "vuedraggable";
import { usePptStore } from "../stores/ppt.store.ts";
import type { PptPagePatch } from "../api/ppt.api.ts";
import PptNote from "./PptNote.vue";
import PptAiGenerateDialog from "./PptAiGenerateDialog.vue";

const props = defineProps<{ projectId: string }>();
const store = usePptStore();

const aiOpen = ref(false);

const pages = computed(() => store.getList(props.projectId));

onMounted(async () => {
  await store.load(props.projectId);
});

function openAi(): void {
  aiOpen.value = true;
}

async function onCreate(): Promise<void> {
  await store.create(props.projectId, {
    title: `新便签 #${pages.value.length + 1}`,
    prompt: "",
  });
}

async function onUpdate(id: string, patch: PptPagePatch): Promise<void> {
  await store.update(props.projectId, id, patch);
}

async function onDelete(id: string): Promise<void> {
  await store.deletePage(props.projectId, id);
}

/** draggable 把整个数组返出来 → 拿到新顺序的 ids 调 reorder */
async function onDragEnd(next: { id: string }[]): Promise<void> {
  const ids = next.map((p) => p.id);
  await store.reorder(props.projectId, ids);
}

async function onExport(): Promise<void> {
  const md = await store.exportMarkdown(props.projectId);
  if (!md) return;
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `提案PPT设计-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>