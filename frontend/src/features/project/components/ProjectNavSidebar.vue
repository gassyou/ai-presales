<!--
  ProjectNavSidebar.vue
  =====================
  项目详情页左侧导航（按阶段分组，5 大组，27 项）。

  设计：
    - 默认 220px，可在 160~360 间拖动调整
    - 父组件维护 width + activeKey；本组件仅渲染 + emit
    - 5 组默认全部展开（无折叠交互）
    - 选中项：高亮 bg-accent-soft + text-accent
-->
<template>
  <nav
    class="flex h-full min-h-0 shrink-0 flex-col overflow-y-auto border-r border-border bg-white py-3"
    :style="{ width: width + 'px' }"
  >
    <h2 class="px-3 pb-2 text-xs font-medium text-slate-500">项目模块</h2>

    <div v-for="g in groups" :key="g.key" class="mb-2">
      <div class="flex items-center px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {{ g.label }}
      </div>
      <ul>
        <li v-for="it in g.items" :key="it.key">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition"
            :class="activeKey === it.key
              ? 'bg-accent-soft text-accent-700 font-medium'
              : 'text-slate-700 hover:bg-surface-alt'"
            @click="emit('update:activeKey', it.key)"
          >
            <span class="truncate">{{ it.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </nav>
</template>

<script setup lang="ts">
defineProps<{
  groups: Array<{ key: string; label: string; items: Array<{ key: string; label: string }> }>;
  activeKey: string;
  width: number;
}>();

const emit = defineEmits<{
  (e: "update:activeKey", key: string): void;
  (e: "update:width", px: number): void;
}>();
</script>
