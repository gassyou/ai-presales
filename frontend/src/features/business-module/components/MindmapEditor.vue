<!--
  MindmapEditor.vue
  =================
  递归脑图编辑器（阶段 7.4i —— 改用 vue3-mindmap）。

  数据：MindmapNode = { id, text, children: MindmapNode[] }
  操作（vue3-mindmap 内建）：
    - 双击节点编辑文本
    - 右键节点弹出菜单（加子 / 加兄弟 / 升级 / 降级 / 删除 / 复制 / 粘贴）
    - 拖拽节点调整层级
    - 折叠 / 展开（点击 chevron）
    - 撤销 / 重做（右上角按钮）
    - 缩放 / 平移
  操作栏说明文字保留以提示用户操作方式。
-->
<template>
  <div class="flex h-[70vh] min-h-[480px] flex-col gap-2">
    <div class="rounded border border-border bg-white/40 p-2 text-[11px] text-slate-600">
      <span class="font-medium text-slate-700">操作：</span>
      双击改名 / 右键节点弹出菜单（＋子 / ⎁兄弟 / ← → 调层级 / ✕删除 / 复制粘贴）/
      拖拽节点 / 右上角撤销重做 / 滚轮缩放
    </div>
    <div class="flex-1 overflow-hidden rounded border border-border bg-white/30">
      <mindmap
        v-model="data"
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
        @update:modelValue="onChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import Mindmap from "vue3-mindmap";
import "vue3-mindmap/dist/style.css";
import type { MindmapNode } from "../api/survey-questionnaire.api.ts";
import {
  mindmapToV3,
  v3ToMindmap,
  type Vue3MindmapNode,
} from "../composables/useMindmapAdapter.ts";

const props = defineProps<{ nodes: MindmapNode[] }>();
const emit = defineEmits<{
  "update:nodes": [MindmapNode[]];
}>();

// 用本地 ref 持有 vue3-mindmap 的 v-model；props 变化时 deep sync
const data = ref<Vue3MindmapNode[]>(mindmapToV3(props.nodes));

watch(
  () => props.nodes,
  (incoming) => {
    // 避免父→子 sync 时把父刚改的数据又重置回去
    const next = mindmapToV3(incoming);
    // 浅比较：如果文本结构相同就不更新（用户正在编辑）
    if (JSON.stringify(next) !== JSON.stringify(data.value)) {
      data.value = next;
    }
  },
  { deep: true },
);

function onChange(next: Vue3MindmapNode[]): void {
  data.value = next;
  emit("update:nodes", v3ToMindmap(next));
}
</script>