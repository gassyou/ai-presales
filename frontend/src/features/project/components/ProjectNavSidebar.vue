<!--
  ProjectNavSidebar.vue
  =====================
  项目详情页左侧导航（按阶段分组，5 大组，27 项）。

  设计：
    - 默认 220px，可在 160~360 间拖动调整
    - 父组件维护 width + activeKey；本组件仅渲染 + emit
    - 5 组默认全部展开；点击组标题折叠/展开（无持久化）
    - 选中项：高亮 bg-accent-soft + text-accent
-->
<template>
  <nav
    class="flex h-full min-h-0 shrink-0 flex-col overflow-y-auto border-r border-border bg-white py-3"
    :style="{ width: width + 'px' }"
  >
    <div v-for="g in groups" :key="g.key" class="mb-1">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] font-bold uppercase tracking-wide text-slate-900 hover:bg-surface-alt"
        @click="toggleGroup(g.key)"
      >
        <span class="inline-block w-2 text-center text-[10px]">
          {{ expandedGroups[g.key] ? "▾" : "▸" }}
        </span>
        <span class="truncate">{{ g.label }}</span>
      </button>
      <ul v-show="expandedGroups[g.key]">
        <li v-for="it in g.items" :key="it.key">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition"
            :class="activeKey === it.key
              ? 'bg-accent-soft text-accent-700 font-medium'
              : 'text-slate-700 hover:bg-surface-alt'"
            @click="emit('update:activeKey', it.key)"
          >
            <span class="truncate pl-3">{{ it.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { reactive } from "vue";

const props = defineProps<{
  groups: Array<{ key: string; label: string; items: Array<{ key: string; label: string }> }>;
  activeKey: string;
  width: number;
}>();

const emit = defineEmits<{
  (e: "update:activeKey", key: string): void;
  (e: "update:width", px: number): void;
}>();

/** 默认全部展开。点击组标题切换。 */
const expandedGroups = reactive<Record<string, boolean>>({});
for (const g of props.groups) {
  if (!(g.key in expandedGroups)) expandedGroups[g.key] = true;
}

function toggleGroup(key: string): void {
  expandedGroups[key] = !expandedGroups[key];
}
</script>
