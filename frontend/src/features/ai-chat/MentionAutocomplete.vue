<!--
  MentionAutocomplete.vue
  =======================
  @ 项目候选弹出层（输入 @ 时触发）

  用法：
    <MentionAutocomplete
      :query="currentAtToken"
      :candidates="store.mentionCandidates"
      :position="{top, left}"
      @select="onPick"
      @dismiss="onDismiss"
    />

  阶段 6.0f 简化：
    - 候选从 store.mentionCandidates 来（已在前端过滤）
    - 父组件监听 input 变化，检测到 @xxx 光标前的 token，传给本组件
    - 选中回调：父组件把 token 替换为完整 mention 文本
-->
<template>
  <div
    v-if="visible && candidates.length > 0"
    class="absolute z-50 mt-1 max-h-64 overflow-y-auto rounded border border-border bg-white shadow-xl"
    :style="{ top: `${position.top}px`, left: `${position.left}px`, minWidth: '240px' }"
  >
    <div class="border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
      引用项目 ({{ candidates.length }})
    </div>
    <ul>
      <li
        v-for="(c, i) in candidates"
        :key="c.id"
        :class="[
          'flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-xs',
          i === activeIndex ? 'bg-surface-alt' : 'hover:bg-surface-alt/60',
        ]"
        @mousedown.prevent="emit('select', c)"
      >
        <div class="flex flex-col">
          <span class="text-slate-900">{{ c.name }}</span>
          <span class="text-[10px] text-slate-500">{{ c.code }} · {{ c.clientName }}</span>
        </div>
        <code class="text-[10px] text-slate-600">@{{ c.code }}</code>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ProjectDTO } from "@shared/types/dto/project.ts";

defineProps<{
  visible: boolean;
  query: string;
  candidates: readonly ProjectDTO[];
  position: { top: number; left: number };
  activeIndex: number;
}>();

const emit = defineEmits<{
  (e: "select", project: ProjectDTO): void;
  (e: "dismiss"): void;
}>();

// re-export emit helper to keep linter happy
void emit;
</script>