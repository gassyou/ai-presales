<!--
  DeliverableView.vue
  ===================
  阶段 B2：交付物清单改为单一 markdown 页面。

  替代旧的「表格 + 抽屉编辑」形态（多个交付物各自一行）：
  现在整个模块是一份长 markdown，所有交付物 / 文档 / 软件 / 服务
  都在同一份文档里以列表 + 表格形式组织。MarkdownModuleView 复用
  通用 markdown 编辑 + AI 生成 + 自动保存逻辑。
-->
<template>
  <MarkdownModuleView
    :project-id="projectId"
    kind="markdown_deliverable"
    title="交付物清单"
  />
</template>

<script setup lang="ts">
import MarkdownModuleView from "./MarkdownModuleView.vue";

defineProps<{ projectId: string }>();
</script>