<!--
  MarkdownEditor.vue
  ===================
  共享的 Markdown 编辑器组件（Bytemd 封装）。

  设计：
    - 集成 @bytemd/vue-next <Editor>，默认 split（窄屏自动 tab）
    - 工具栏插件：gfm（表格/任务列表/删除线）+ highlight（代码高亮）
      + gemoji（:emoji:）+ breaks（软换行转 <br>）
    - 中文 i18n（zh_Hans）
    - v-model 双向绑定（兼容现有 .vue 写法）
    - 预留：暴露 Bytemd handle 给父组件（弹工具栏 / focus 等高级场景，本期未启用）

  用法（最小）：
    <MarkdownEditor v-model="draft" :placeholder="..." />

  说明：
    - 不接管自动保存：保持各模块原有的 800ms debounce 逻辑不变
    - 不接管 AI 生成 / 下载：仍由父组件控制
-->
<template>
  <div class="md-editor-wrapper">
    <Editor
      :value="modelValue"
      :plugins="plugins"
      :mode="mode"
      :placeholder="placeholder"
      :preview-debounce="300"
      :locale="locale"
      @change="onChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Editor } from "@bytemd/vue-next";
import gfm from "@bytemd/plugin-gfm";
import highlight from "@bytemd/plugin-highlight";
import gemoji from "@bytemd/plugin-gemoji";
import breaks from "@bytemd/plugin-breaks";
import zhHans from "bytemd/locales/zh_Hans.json";
import "bytemd/dist/index.css";
import "highlight.js/styles/github.css";

const props = defineProps<{
  /** 双向绑定：md 原文 */
  modelValue: string;
  /** 占位文字 */
  placeholder?: string;
  /**
   * 编辑器布局：
   *   - "auto"：宽屏 split（左右）/ 窄屏 tab（默认）
   *   - "split"：强制左右双栏
   *   - "tab"：强制 tab 切换
   */
  mode?: "auto" | "split" | "tab";
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const plugins = computed(() => [
  gfm(),
  highlight(),
  gemoji(),
  breaks(),
]);

const locale = computed(() => zhHans);

function onChange(v: string): void {
  emit("update:modelValue", v);
}
</script>

<style scoped>
.md-editor-wrapper {
  /* 与现有 card 视觉对齐（border.DEFAULT = #E5E7EB） */
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.md-editor-wrapper :deep(.bytemd) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* Bytemd 默认主题偏暗，与本系统浅色商务风冲突，做轻量覆写 */
.md-editor-wrapper :deep(.bytemd) {
  background: #fff;
  color: #1f2937;
}

.md-editor-wrapper :deep(.bytemd-toolbar) {
  background: #f8fafc;
  border-bottom: 1px solid #E5E7EB;
}

.md-editor-wrapper :deep(.bytemd-body) {
  background: #fff;
}

.md-editor-wrapper :deep(.bytemd-editor) {
  /* CodeMirror 编辑区 */
  background: #fff;
  color: #1f2937;
}

.md-editor-wrapper :deep(.bytemd-editor .CodeMirror) {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
}

.md-editor-wrapper :deep(.bytemd-preview) {
  background: #fff;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.6;
}

/* Bytemd 自带 .markdown-body 是 GitHub 样式，这里微调以贴合卡片风格 */
.md-editor-wrapper :deep(.markdown-body) {
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    "PingFang SC",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    sans-serif;
  color: #1f2937;
  background: transparent;
}

/* 让 hr / blockquote / table 等元素与现有 Tailwind 卡片色和谐 */
.md-editor-wrapper :deep(.markdown-body blockquote) {
  border-left: 3px solid #059669;
  background: #f0fdf4;
  color: #047857;
}

.md-editor-wrapper :deep(.markdown-body code:not(pre code)) {
  background: #f1f5f9;
  color: #0f172a;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.92em;
}

.md-editor-wrapper :deep(.markdown-body pre) {
  background: #f8fafc;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
}

.md-editor-wrapper :deep(.markdown-body table) {
  border-collapse: collapse;
}

.md-editor-wrapper :deep(.markdown-body table th),
.md-editor-wrapper :deep(.markdown-body table td) {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
}

.md-editor-wrapper :deep(.markdown-body table tr:nth-child(2n)) {
  background: #f8fafc;
}

/* 移除 min-height：让父容器 (MarkdownModuleView) 通过 flex-1 撑开 */
.md-editor-wrapper :deep(.bytemd) {
  flex: 1 1 auto;
}
</style>