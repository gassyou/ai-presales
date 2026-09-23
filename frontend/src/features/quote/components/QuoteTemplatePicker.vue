<!--
  QuoteTemplatePicker.vue
  ========================
  报价单模板选择器（阶段 7.4f）。
  - 下拉列模板（内置默认 + 项目上传）
  - 显示「+ 上传新模板」按钮
-->
<template>
  <div class="flex items-center gap-2 text-xs">
    <label class="text-slate-600">模板：</label>
    <select
      :value="modelValue ?? ''"
      class="rounded border border-border bg-surface-alt px-2 py-1 text-slate-800"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value || undefined)"
    >
      <option value="">（使用内置默认）</option>
      <option v-for="t in templates" :key="t.id" :value="t.id">
        {{ t.projectId === null ? "[内置] " : "" }}{{ t.originalFilename }}
      </option>
    </select>
    <input
      ref="fileInput"
      type="file"
      accept=".xlsx"
      class="hidden"
      @change="onUpload"
    />
    <button
      class="rounded bg-surface-sunken px-2 py-1 text-slate-800 hover:bg-slate-600"
      @click="triggerUpload"
    >+ 上传</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { TemplateDTO } from "../api/quote.api.ts";

const props = defineProps<{
  templates: TemplateDTO[];
  modelValue?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string | undefined];
  upload: [file: File];
}>();

const fileInput = ref<HTMLInputElement | null>(null);

function triggerUpload() {
  fileInput.value?.click();
}

function onUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  emit("upload", file);
  target.value = ""; // 允许重复上传同名文件
}
</script>