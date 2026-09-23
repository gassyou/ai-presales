<!--
  FunctionListTable.vue
  =====================
  功能清单列表视图（阶段 7.4b）。
  - 每行：分类 / 模块 / 功能名 / 详细 / 备注 / CP select / 范围内 checkbox / 工时 / 金额 / 删
  - 点击单元格编辑（contenteditable + @blur）
  - CP / 范围内用 <select> / <checkbox> 直接触发 update
-->
<template>
  <div class="overflow-x-auto rounded border border-border">
    <table class="w-full text-xs">
      <thead class="bg-surface-alt/60 text-slate-700">
        <tr>
          <th class="px-2 py-2 text-left">分类</th>
          <th class="px-2 py-2 text-left">模块</th>
          <th class="px-2 py-2 text-left">功能名</th>
          <th class="px-2 py-2 text-left">详细</th>
          <th class="px-2 py-2 text-left">备注</th>
          <th class="px-2 py-2 text-right">CP</th>
          <th class="px-2 py-2 text-center">范围内</th>
          <th class="px-2 py-2 text-right">工时(h)</th>
          <th class="px-2 py-2 text-right">金额</th>
          <th class="px-2 py-2 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="it in items"
          :key="it.id"
          class="border-t border-border hover:bg-surface-alt/30"
        >
          <td class="px-2 py-1">
            <span class="block max-w-[120px] truncate" :title="it.category" @blur="onEdit(it, 'category', ($event.target as HTMLElement).innerText.trim())" contenteditable>{{ it.category }}</span>
          </td>
          <td class="px-2 py-1">
            <span class="block max-w-[120px] truncate" :title="it.module" @blur="onEdit(it, 'module', ($event.target as HTMLElement).innerText.trim())" contenteditable>{{ it.module }}</span>
          </td>
          <td class="px-2 py-1">
            <span class="block max-w-[160px] truncate font-medium text-slate-900" :title="it.name" @blur="onEdit(it, 'name', ($event.target as HTMLElement).innerText.trim())" contenteditable>{{ it.name }}</span>
          </td>
          <td class="px-2 py-1">
            <span class="block max-w-[200px] truncate text-slate-600" :title="it.detail" @blur="onEdit(it, 'detail', ($event.target as HTMLElement).innerText.trim())" contenteditable>{{ it.detail }}</span>
          </td>
          <td class="px-2 py-1">
            <span class="block max-w-[140px] truncate text-slate-600" :title="it.remarks" @blur="onEdit(it, 'remarks', ($event.target as HTMLElement).innerText.trim())" contenteditable>{{ it.remarks }}</span>
          </td>
          <td class="px-2 py-1 text-right">
            <select
              :value="it.cp"
              class="rounded border border-border bg-white px-1 py-0.5 text-right text-xs text-slate-800"
              @change="(e) => emit('changeCp', it, Number((e.target as HTMLSelectElement).value))"
            >
              <option :value="0">—</option>
              <option v-for="cp in CP_VALUES" :key="cp" :value="cp">{{ cp }}</option>
            </select>
          </td>
          <td class="px-2 py-1 text-center">
            <input
              type="checkbox"
              :checked="it.inScope"
              @change="emit('toggleScope', it)"
            />
          </td>
          <td class="px-2 py-1 text-right text-slate-700">
            {{ it.effortHours.toFixed(1) }}
          </td>
          <td class="px-2 py-1 text-right text-slate-700">
            ¥{{ Math.round(it.amount).toLocaleString() }}
          </td>
          <td class="px-2 py-1 text-right">
            <button
              class="text-accent hover:underline"
              @click="emit('edit', it)"
            >编辑</button>
            <button
              class="ml-2 text-red-300 hover:underline"
              @click="emit('delete', it.id)"
            >删</button>
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="10" class="px-2 py-3 text-center text-slate-500">暂无数据</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { CP_VALUES } from "../api/structured-modules.api.ts";
import type { FunctionListDTO } from "../api/structured-modules.api.ts";

const props = defineProps<{ items: FunctionListDTO[] }>();
const emit = defineEmits<{
  (e: "edit", it: FunctionListDTO): void;
  (e: "delete", id: string): void;
  (e: "toggleScope", it: FunctionListDTO): void;
  (e: "changeCp", it: FunctionListDTO, cp: number): void;
  (e: "cellEdit", it: FunctionListDTO, field: "category" | "module" | "name" | "detail" | "remarks", value: string): void;
}>();

async function onEdit(it: FunctionListDTO, field: "category" | "module" | "name" | "detail" | "remarks", value: string): Promise<void> {
  if ((it as unknown as Record<string, string>)[field] === value) return;
  if (field === "name" && value.length === 0) return; // 不允许清空 name
  emit("cellEdit", it, field, value);
}
</script>