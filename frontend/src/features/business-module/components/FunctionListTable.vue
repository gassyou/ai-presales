<!--
  FunctionListTable.vue
  =====================
  功能清单列表视图（阶段 7.4b + Element Plus 迁移）。
  - 每行：分类 / 模块 / 功能名 / 详细 / 备注 / CP select / 范围内 checkbox / 工时 / 金额 / 删
  - 点击单元格编辑（contenteditable + @blur）
  - CP / 范围内用 <el-select> / <el-checkbox> 直接触发 update
  - Element Plus el-table 的 #default slot 不带业务类型，所以 editable cell 通过
    scoped helper "typed" cast 一次；用 prop 显示纯文本字段，避免对每个字段都 cast。
-->
<template>
  <el-table
    :data="items"
    size="small"
    border
    stripe
    class="rounded"
    empty-text="暂无数据"
  >
    <el-table-column label="分类" min-width="120">
      <template #default="{ row }">
        <span
          class="block max-w-[120px] truncate"
          :title="typed(row).category"
          contenteditable
          @blur="onEdit(typed(row), 'category', ($event.target as HTMLElement).innerText.trim())"
        >{{ typed(row).category }}</span>
      </template>
    </el-table-column>
    <el-table-column label="模块" min-width="120">
      <template #default="{ row }">
        <span
          class="block max-w-[120px] truncate"
          :title="typed(row).module"
          contenteditable
          @blur="onEdit(typed(row), 'module', ($event.target as HTMLElement).innerText.trim())"
        >{{ typed(row).module }}</span>
      </template>
    </el-table-column>
    <el-table-column label="功能名" min-width="160">
      <template #default="{ row }">
        <span
          class="block max-w-[160px] truncate font-medium text-slate-900"
          :title="typed(row).name"
          contenteditable
          @blur="onEdit(typed(row), 'name', ($event.target as HTMLElement).innerText.trim())"
        >{{ typed(row).name }}</span>
      </template>
    </el-table-column>
    <el-table-column label="详细" min-width="200">
      <template #default="{ row }">
        <span
          class="block max-w-[200px] truncate text-slate-600"
          :title="typed(row).detail"
          contenteditable
          @blur="onEdit(typed(row), 'detail', ($event.target as HTMLElement).innerText.trim())"
        >{{ typed(row).detail }}</span>
      </template>
    </el-table-column>
    <el-table-column label="备注" min-width="140">
      <template #default="{ row }">
        <span
          class="block max-w-[140px] truncate text-slate-600"
          :title="typed(row).remarks"
          contenteditable
          @blur="onEdit(typed(row), 'remarks', ($event.target as HTMLElement).innerText.trim())"
        >{{ typed(row).remarks }}</span>
      </template>
    </el-table-column>
    <el-table-column label="CP" width="80" align="right">
      <template #default="{ row }">
        <el-select
          :model-value="typed(row).cp"
          size="small"
          class="!w-16"
          @change="(v) => emit('changeCp', typed(row), Number(v))"
        >
          <el-option label="—" :value="0" />
          <el-option v-for="cp in CP_VALUES" :key="cp" :label="String(cp)" :value="cp" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="范围内" width="80" align="center">
      <template #default="{ row }">
        <el-checkbox
          :model-value="typed(row).inScope"
          @change="emit('toggleScope', typed(row))"
        />
      </template>
    </el-table-column>
    <el-table-column label="工时(h)" width="90" align="right">
      <template #default="{ row }">{{ typed(row).effortHours.toFixed(1) }}</template>
    </el-table-column>
    <el-table-column label="金额" width="110" align="right">
      <template #default="{ row }">¥{{ Math.round(typed(row).amount).toLocaleString() }}</template>
    </el-table-column>
    <el-table-column label="操作" width="120" align="right">
      <template #default="{ row }">
        <el-button link type="primary" size="small" @click="emit('edit', typed(row))">编辑</el-button>
        <el-button link type="danger" size="small" @click="emit('delete', typed(row).id)">删</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import { CP_VALUES } from "../api/structured-modules.api.ts";
import type { FunctionListDTO } from "../api/structured-modules.api.ts";

defineProps<{ items: FunctionListDTO[] }>();
const emit = defineEmits<{
  (e: "edit", it: FunctionListDTO): void;
  (e: "delete", id: string): void;
  (e: "toggleScope", it: FunctionListDTO): void;
  (e: "changeCp", it: FunctionListDTO, cp: number): void;
  (e: "cellEdit", it: FunctionListDTO, field: "category" | "module" | "name" | "detail" | "remarks", value: string): void;
}>();

// el-table 的 #default slot 默认 row 类型是 DefaultRow（无业务字段）。
// 用 helper cast 一下，template 里每个表达式都走它。
const typed = (row: unknown): FunctionListDTO => row as FunctionListDTO;

function onEdit(it: FunctionListDTO, field: "category" | "module" | "name" | "detail" | "remarks", value: string): void {
  if ((it as unknown as Record<string, string>)[field] === value) return;
  if (field === "name" && value.length === 0) return; // 不允许清空 name
  emit("cellEdit", it, field, value);
}
</script>