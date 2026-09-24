<!--
  PptNote.vue
  ===========
  单张 PPT 便签（阶段 7.4c）。

  形态：
    - 顶部：拖拽 handle + 序号 + 标题（双击进编辑态）
    - 中部：prompt 内容（双击编辑；textarea autosize）
    - 右下角：删除按钮
    - 默认 220×140；位置由父容器 grid / draggable 决定
-->
<template>
  <div
    class="flex flex-col gap-1 rounded border border-border bg-surface-alt p-2 text-xs text-slate-900 shadow"
    :style="{ width: `${page.width}px`, height: `${page.height}px` }"
  >
    <div class="flex items-center gap-1">
      <span
        class="drag-handle cursor-move select-none rounded bg-surface-sunken px-1 text-slate-600"
        title="拖拽排序"
      >⠿</span>
      <span class="rounded bg-accent/20 px-1 text-[10px] text-accent">#{{ page.ordinal + 1 }}</span>
      <el-input
        v-if="editingTitle"
        v-model="titleDraft"
        size="small"
        class="flex-1"
        @blur="commitTitle"
        @keydown.enter="commitTitle"
        @keydown.esc="editingTitle = false"
      />
      <span
        v-else
        class="flex-1 cursor-text truncate"
        :title="page.title"
        @dblclick="startEditTitle"
      >{{ page.title || "（未命名）" }}</span>
      <el-button
        link
        type="danger"
        size="small"
        title="删除"
        @click="onDelete"
      >✕</el-button>
    </div>
    <el-input
      v-model="promptDraft"
      type="textarea"
      class="flex-1"
      :placeholder="'该页 AI 提示词…'"
      @blur="commitPrompt"
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
const titleDraft = ref(props.page.title);
const promptDraft = ref(props.page.prompt);

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

function commitPrompt(): void {
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