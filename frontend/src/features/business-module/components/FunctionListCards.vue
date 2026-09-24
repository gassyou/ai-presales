<!--
  FunctionListCards.vue
  =====================
  功能清单卡片视图（阶段 7.4b）。
  - 按 category → module 分组
  - 每张卡片 = 一个功能；inline 编辑字段（hover 显示编辑按钮）
-->
<template>
  <div class="space-y-4">
    <div v-for="cat in grouped" :key="cat.category">
      <h3 class="mb-2 text-xs font-medium text-slate-700">📁 {{ cat.category || "(未分类)" }}</h3>
      <div v-for="mod in cat.modules" :key="mod.module" class="ml-3">
        <h4 class="mb-1 text-xs text-slate-600">📂 {{ mod.module || "(未分模块)" }}</h4>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="fn in mod.functions"
            :key="fn.id"
            class="rounded border border-border bg-white/40 p-3 text-xs hover:border-accent/40"
          >
            <div class="flex items-start justify-between gap-2">
              <h5 class="font-medium text-slate-900">{{ fn.name }}</h5>
              <label class="flex items-center gap-1 text-slate-600">
                <el-checkbox :model-value="fn.inScope" @update:model-value="emit('toggleScope', fn)" />
                <span>范围内</span>
              </label>
            </div>
            <p v-if="fn.detail" class="mt-1 text-slate-600">{{ fn.detail }}</p>
            <p v-if="fn.remarks" class="mt-1 italic text-slate-500">{{ fn.remarks }}</p>
            <div class="mt-2 flex items-center justify-between border-t border-border pt-2">
              <span class="text-slate-600">CP: <strong class="text-slate-800">{{ fn.cp || "—" }}</strong></span>
              <span class="text-slate-700">{{ fn.effortHours.toFixed(1) }}h</span>
              <span class="text-slate-700">¥{{ Math.round(fn.amount).toLocaleString() }}</span>
            </div>
            <div class="mt-2 flex justify-end gap-2">
              <el-button link type="primary" size="small" @click="emit('edit', fn)">编辑</el-button>
              <el-button link type="danger" size="small" @click="emit('delete', fn.id)">删</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="grouped.length === 0" class="rounded border border-border bg-white/40 p-4 text-center text-xs text-slate-500">
      暂无功能
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FunctionListDTO } from "../api/structured-modules.api.ts";

const props = defineProps<{ items: FunctionListDTO[] }>();
const emit = defineEmits<{
  (e: "edit", it: FunctionListDTO): void;
  (e: "delete", id: string): void;
  (e: "toggleScope", it: FunctionListDTO): void;
}>();

interface GroupNode {
  category: string;
  modules: { module: string; functions: FunctionListDTO[] }[];
}

const grouped = computed<GroupNode[]>(() => {
  const byCat = new Map<string, Map<string, FunctionListDTO[]>>();
  for (const it of props.items) {
    const cat = byCat.get(it.category) ?? new Map();
    const mod = cat.get(it.module) ?? [];
    mod.push(it);
    cat.set(it.module, mod);
    byCat.set(it.category, cat);
  }
  const out: GroupNode[] = [];
  for (const [category, modMap] of byCat) {
    const modules: { module: string; functions: FunctionListDTO[] }[] = [];
    for (const [module, fns] of modMap) modules.push({ module, functions: fns });
    out.push({ category, modules });
  }
  return out;
});
</script>