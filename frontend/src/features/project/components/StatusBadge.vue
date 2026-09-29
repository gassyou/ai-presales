<!--
  StatusBadge.vue
  ==============
  项目状态徽章，按状态上色。
-->
<template>
  <span
    class="rounded px-1.5 py-0.5 text-xs font-medium"
    :class="badgeClass"
  >
    {{ status }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ProjectStatusValue } from "@shared/types/dto/project.ts";

const props = defineProps<{ status: ProjectStatusValue }>();

const badgeClass = computed<string>(() => {
  switch (props.status) {
    case "新建":
      return "bg-surface-sunken/60 text-slate-800";
    case "提案中":
      return "bg-blue-500/20 text-blue-700";
    case "暂停":
      return "bg-amber-500/20 text-amber-700";
    case "中标":
      return "bg-emerald-500/20 text-emerald-700";
    case "未中标":
      return "bg-red-500/20 text-red-300";
    // 阶段 1："中止" 用深灰色（终态，与"未中标"区分）
    case "中止":
      return "bg-slate-700 text-slate-100";
  }
});
</script>