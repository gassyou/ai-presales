<!--
  SideNav.vue
  ===========
  工作台左侧导航（浅色商务风）

  - 父容器（WorkspaceShell）已控制宽度；本组件只负责内容。
  - 高度继承父容器 h-full。
-->
<template>
  <nav
    class="flex h-full w-full flex-col gap-4 overflow-y-auto border-border bg-canvas-subtle px-2 py-3 text-sm"
    :class="side === 'left' ? 'border-r' : 'border-l'"
  >
    <div v-for="group in groups" :key="group.title">
      <div class="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {{ group.title }}
      </div>
      <ul class="flex flex-col gap-0.5">
        <li v-for="item in group.items" :key="item.name">
          <router-link
            :to="{ name: item.routeName }"
            class="flex items-center justify-between rounded-md px-2 py-1.5 text-slate-700 transition-colors hover:bg-surface-sunken"
            active-class="bg-accent-soft text-accent-ink font-medium"
          >
            <span class="truncate">{{ item.label }}</span>
            <span v-if="item.shortcut" class="ml-2 text-xs text-slate-400">{{ item.shortcut }}</span>
          </router-link>
        </li>
      </ul>
    </div>

    <div class="mt-auto px-2 pt-2 text-[10px] leading-snug text-slate-400">
      本机存储 · 仅单用户
    </div>
  </nav>
</template>

<script setup lang="ts">
defineProps<{ side?: "left" | "right" }>();

interface NavItem {
  name: string;
  label: string;
  routeName: string;
  shortcut?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    title: "主功能",
    items: [
      { name: "dashboard", label: "仪表盘", routeName: "dashboard", shortcut: "G D" },
    ],
  },
  {
    title: "项目",
    items: [
      { name: "projects", label: "项目列表", routeName: "projects" },
    ],
  },
  {
    title: "AI 协作",
    items: [
      { name: "ai", label: "AI 对话框", routeName: "ai" },
    ],
  },
  {
    title: "系统",
    items: [
      { name: "settings", label: "系统设置", routeName: "settings" },
    ],
  },
];
</script>