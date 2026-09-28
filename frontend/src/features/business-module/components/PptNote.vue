<!--
  PptNote.vue
  ===========
  单张 PPT 便签（阶段 7.4c 重构）。

  形态：
    - mac 便签风格，背景色由 id 哈希决定（黄/粉/蓝/绿/紫/橙/灰）
    - 便签大小**随内容自适应**（去掉固定 width/height，改由 min-h + 内容驱动）
    - 顶部：序号 + 标题（双击编辑）
    - 中部：prompt markdown 预览（点击编辑）
    - 右下：删除按钮
-->
<template>
  <div
    class="group relative flex min-h-[150px] cursor-text flex-col gap-2 rounded-md border border-black/5 p-3 text-xs shadow-sm transition hover:shadow-md"
    :class="noteBgClass(page.id)"
  >
    <div class="flex items-center gap-2">
      <span class="rounded bg-black/10 px-1 text-[10px] text-black/60">#{{ page.ordinal + 1 }}</span>
      <el-input
        v-if="editingTitle"
        v-model="titleDraft"
        size="small"
        class="flex-1"
        @blur="commitTitle"
        @keydown.enter="commitTitle"
        @keydown.esc="editingTitle = false"
        @click.stop
      />
      <span
        v-else
        class="flex-1 cursor-text truncate text-sm font-semibold text-black/85"
        :title="page.title"
        @dblclick="startEditTitle"
      >{{ page.title || "（未命名）" }}</span>
      <el-button
        link
        type="danger"
        size="small"
        title="删除"
        @click.stop="onDelete"
      >✕</el-button>
    </div>

    <!-- 内容预览（默认） -->
    <div
      v-if="!editingPrompt"
      class="prose prose-sm max-w-none flex-1 whitespace-pre-wrap text-[11px] leading-relaxed text-black/75"
      @dblclick="startEditPrompt"
    >{{ page.prompt || "双击编辑该页 AI 提示词…" }}</div>

    <!-- 内容编辑 -->
    <el-input
      v-else
      v-model="promptDraft"
      type="textarea"
      :rows="5"
      class="flex-1"
      :autosize="{ minRows: 3, maxRows: 20 }"
      @blur="commitPrompt"
      @keydown.esc="editingPrompt = false"
      @click.stop
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { PptPageDTO, PptPagePatch } from "../api/ppt.api.ts";

const props = defineProps<{ page: PptPageDTO }>();
const emit = defineEmits<{
  (e: "update", id: string, patch: PptPagePatch): void;
  (e: "delete", id: string): void;
}>();

const editingTitle = ref(false);
const editingPrompt = ref(false);
const titleDraft = ref(props.page.title);
const promptDraft = ref(props.page.prompt);

/** mac 便签背景色板（7 种） */
const NOTE_COLORS = [
  "bg-yellow-100",
  "bg-pink-100",
  "bg-blue-100",
  "bg-green-100",
  "bg-purple-100",
  "bg-orange-100",
  "bg-slate-100",
];

function noteBgClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return NOTE_COLORS[Math.abs(hash) % NOTE_COLORS.length] ?? "bg-yellow-100";
}

function startEditTitle(): void {
  titleDraft.value = props.page.title;
  editingTitle.value = true;
}

function commitTitle(): void {
  editingTitle.value = false;
  if (titleDraft.value !== props.page.title && titleDraft.value.trim().length > 0) {
    emit("update", props.page.id, { title: titleDraft.value.trim() });
  }
}

function startEditPrompt(): void {
  promptDraft.value = props.page.prompt;
  editingPrompt.value = true;
}

function commitPrompt(): void {
  editingPrompt.value = false;
  if (promptDraft.value !== props.page.prompt) {
    emit("update", props.page.id, { prompt: promptDraft.value });
  }
}

async function onDelete(): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除便签「${props.page.title || "(未命名)"}」？`, "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  emit("delete", props.page.id);
}
</script>