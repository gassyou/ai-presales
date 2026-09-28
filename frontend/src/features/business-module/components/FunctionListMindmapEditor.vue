<!--
  FunctionListMindmapEditor.vue
  ==============================
  功能清单脑图编辑器（阶段 7.4i + 重构）。
  - 左侧脑图（vue3-mindmap）：category → module → functionName 三级嵌套
  - 用户在主区**直接编辑脑图**（双击改名 / 右键菜单增删 / 拖拽节点调层级）
  - 任何修改 → 800ms debounce 后计算 diff → 批量 PATCH/POST/DELETE 后端
-->
<template>
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <div class="rounded border border-border bg-amber-50/50 p-2 text-[11px] text-slate-600">
      <span class="font-medium text-slate-700">操作：</span>
      双击改名 / 右键弹出菜单（＋子 / ⎁兄弟 / ←→ 调层级 / ✕删除 / 复制粘贴）/
      拖拽节点 / 右上角撤销重做 / 滚轮缩放
      <span class="ml-2 text-slate-500">{{ saveStatus }}</span>
    </div>
    <div class="flex-1 overflow-hidden rounded border border-border bg-white/30">
      <mindmap
        v-model="tree"
        :edit="true"
        :add-node-btn="true"
        :timetravel="true"
        :zoom="true"
        :drag="true"
        :center-btn="true"
        :fit-btn="true"
        :ctm="true"
        :sharp-corner="false"
        locale="zh"
        @update:modelValue="onTreeChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Mindmap from "vue3-mindmap";
import "vue3-mindmap/dist/style.css";
import {
  functionsToV3,
  diffFunctionTree,
  type Vue3MindmapNode,
} from "../composables/useMindmapAdapter.ts";
import type { FunctionListDTO } from "../api/structured-modules.api.ts";
import { useBudgetStore } from "../stores/budget.store.ts";

const props = defineProps<{ items: FunctionListDTO[]; projectId: string }>();
const emit = defineEmits<{
  (e: "select", it: FunctionListDTO | null): void;
}>();

const store = useBudgetStore();

/** 当前 v3 树（vue3-mindmap 编辑的对象） */
const tree = ref<Vue3MindmapNode[]>([]);
/** 上次已保存快照（用于 diff） */
let savedSnapshot: Vue3MindmapNode[] = [];

/** 同步 props.items 到 tree */
function rebuildFromItems(): void {
  const result = functionsToV3(props.items);
  tree.value = result.tree;
  savedSnapshot = JSON.parse(JSON.stringify(result.tree)) as Vue3MindmapNode[];
}

watch(
  () => props.items,
  () => rebuildFromItems(),
  { immediate: true, deep: true },
);

const saving = ref(false);
const lastSavedAt = ref<Date | null>(null);
const saveStatus = computed<string>(() => {
  if (saving.value) return "保存中…";
  if (lastSavedAt.value) return `已保存 ${formatRelative(lastSavedAt.value)}`;
  return "";
});

function formatRelative(d: Date): string {
  const delta = Date.now() - d.getTime();
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

let saveTimer: number | null = null;
function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await flush();
  }, 800) as unknown as number;
}

async function flush(): Promise<void> {
  // 比对当前 tree vs savedSnapshot，若无变化就不打后端
  const cur = JSON.stringify(tree.value);
  const prev = JSON.stringify(savedSnapshot);
  if (cur === prev) return;
  saving.value = true;
  try {
    const diff = diffFunctionTree(props.items, tree.value);
    // 执行批量操作（先 delete 再 create 避免 id 碰撞）
    for (const id of diff.deletes) {
      await store.deleteFunction(props.projectId, id);
    }
    for (const u of diff.updates) {
      await store.updateFunction(props.projectId, u.id, u.patch);
    }
    for (const c of diff.creates) {
      await store.createFunction(props.projectId, c);
    }
    savedSnapshot = JSON.parse(JSON.stringify(tree.value)) as Vue3MindmapNode[];
    lastSavedAt.value = new Date();
  } catch (e) {
    console.error("[function-mindmap] save failed:", e);
  } finally {
    saving.value = false;
  }
}

function onTreeChange(next: Vue3MindmapNode[]): void {
  tree.value = next;
  emit("select", null);
  scheduleSave();
}
</script>