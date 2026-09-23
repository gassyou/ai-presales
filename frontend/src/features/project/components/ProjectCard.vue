<!--
  ProjectCard.vue
  ===============
  单个项目卡片；显示业务编号 / 名称 / 客户 / 状态徽章。
-->
<template>
  <article
    class="card flex flex-col gap-1.5 transition-colors hover:border-border-strong"
    :class="{ 'ring-1 ring-accent/50': selected }"
    @click="emit('select', project.id)"
  >
    <header class="flex items-baseline justify-between gap-2">
      <code class="text-xs text-slate-500">{{ project.code }}</code>
      <StatusBadge :status="project.status" />
    </header>
    <h3 class="text-sm font-medium text-slate-900">{{ project.name }}</h3>
    <p class="text-xs text-slate-600">客户：{{ project.clientName }}</p>
    <footer class="mt-1 flex items-center justify-between text-xs text-slate-500">
      <span>更新于 {{ formatTime(project.updatedAt) }}</span>
      <button
        v-if="canDelete"
        class="rounded px-1.5 py-0.5 text-slate-600 hover:bg-red-500/20 hover:text-red-300"
        @click.stop="emit('delete', project.id)"
      >
        删除
      </button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import type { ProjectDTO } from "@shared/types/dto/project.ts";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{ project: ProjectDTO; selected?: boolean; canDelete?: boolean }>();
const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "delete", id: string): void;
}>();

void props;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}
</script>