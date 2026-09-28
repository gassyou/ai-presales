<!--
  PptView.vue
  ==========
  提案 PPT 设计容器（阶段 7.4c 重构）。

  形态：
    - 顶部：AI 生成 / 新增便签 / 导出 Markdown
    - 主体：mac 风格便签照片墙（masonry / flex-wrap 布局）
    - 便签大小随内容自适应
    - 每个便签背景色由 id 哈希决定（黄/粉/蓝/绿/紫/橙/灰）
-->
<template>
  <section class="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
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

    <div v-if="pages.length === 0" class="rounded border border-dashed border-border bg-white/30 p-6 text-center text-xs text-slate-500">
      暂无 PPT 页。点击「AI 生成」让 AI 设计 8~15 页提案 PPT，或「新增便签」手工创建。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <div class="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
        <div
          v-for="page in pages"
          :key="page.id"
          class="mb-3 break-inside-avoid"
        >
          <PptNote
            :page="page"
            @update="onUpdate"
            @delete="onDelete"
          />
        </div>
      </div>
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