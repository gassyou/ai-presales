<!--
  ResizableSplit.vue
  ==================
  VSCode 风格的左右拖动面板容器。

  用法：
    <ResizableSplit
      side="left"
      :width="leftWidth"
      :min="180" :max="400"
      :storage-key="'ui.shell.leftNav'"
      :default-width="240"
      @resize="leftWidth = $event"
    >
      <SideNav />
    </ResizableSplit>

  - 子内容始终填满 splitter 内部（width 决定面板宽，剩余主区在外层 flex-1）。
  - 鼠标拖分隔条 → 通过 update:width 事件让父级更新 width。
  - 键盘：聚焦分隔条后 ← → 调宽度 ±8px（可访问性）。
  - 不耦合任何业务组件（SideNav / AIChatDock），纯壳。
-->
<template>
  <div
    v-if="!collapsed"
    class="relative flex h-full min-h-0"
    :class="side === 'left' ? 'flex-row' : 'flex-row-reverse'"
  >
    <!-- 面板内容：固定宽度 -->
    <div
      class="relative flex h-full min-h-0 shrink-0 overflow-hidden"
      :style="{ width: width + 'px' }"
    >
      <slot />
    </div>

    <!-- 分隔条 -->
    <div
      ref="handleEl"
      class="splitter"
      role="separator"
      tabindex="0"
      :aria-orientation="'vertical'"
      :aria-valuenow="width"
      :aria-valuemin="min"
      :aria-valuemax="max"
      @mousedown="onMouseDown"
      @touchstart="onTouchStart"
      @keydown="onKeyDown"
      @dblclick="resetWidth"
    />
  </div>

  <!-- 折叠态：仅显示展开按钮（薄薄一条） -->
  <div
    v-else
    class="flex h-full min-h-0 shrink-0 items-start justify-center border-border pt-3"
    :class="side === 'left' ? 'border-r' : 'border-l'"
    :style="{ width: COLLAPSED_WIDTH + 'px' }"
  >
    <button
      class="rounded-md border border-border bg-white px-1 py-3 text-xs text-slate-500
             hover:bg-surface-alt hover:text-slate-700"
      :title="side === 'left' ? '展开侧栏' : '展开 AI 助手'"
      @click="collapsed = false"
    >
      <span v-if="side === 'left'">›</span>
      <span v-else>‹</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const COLLAPSED_WIDTH = 28; // 折叠后仅剩按钮 + 边框的厚度

const props = defineProps<{
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  storageKey: string;
  collapsed?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:width", px: number): void;
  (e: "update:collapsed", v: boolean): void;
  (e: "reset"): void;
}>();

const handleEl = ref<HTMLDivElement | null>(null);

const collapsed = defineModel<boolean>("collapsed", { default: false });

function updateWidth(px: number): void {
  const clamped = Math.min(props.max, Math.max(props.min, px));
  emit("update:width", clamped);
}

function resetWidth(): void {
  emit("update:width", props.defaultWidth);
  emit("reset");
}

function onMouseDown(e: MouseEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = props.width;

  // 锁定 body 样式，避免拖动时选中文本
  const prevCursor = document.body.style.cursor;
  const prevUserSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  function onMove(ev: MouseEvent): void {
    const delta = ev.clientX - startX;
    // 左面板往左拖 = 缩小；右面板往左拖 = 缩小（delta 同号）
    updateWidth(startWidth + delta);
  }
  function onUp(): void {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevUserSelect;
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function onTouchStart(e: TouchEvent): void {
  if (!e.touches[0]) return;
  const startX = e.touches[0].clientX;
  const startWidth = props.width;
  function onMove(ev: TouchEvent): void {
    const t = ev.touches[0];
    if (!t) return;
    const delta = t.clientX - startX;
    updateWidth(startWidth + delta);
  }
  function onEnd(): void {
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onEnd);
  }
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onEnd);
}

function onKeyDown(e: KeyboardEvent): void {
  const STEP = 8;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    updateWidth(props.width - (props.side === "left" ? STEP : -STEP));
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    updateWidth(props.width + (props.side === "left" ? STEP : -STEP));
  } else if (e.key === "Home") {
    e.preventDefault();
    updateWidth(props.min);
  } else if (e.key === "End") {
    e.preventDefault();
    updateWidth(props.max);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    resetWidth();
  }
}
</script>