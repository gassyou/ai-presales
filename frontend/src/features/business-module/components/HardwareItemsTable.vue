<!--
  HardwareItemsTable.vue
  ======================
  硬件设备清单表格（阶段 7.4f + Element Plus 迁移）。
  - 每行：类别 / 设备 / 规格 / 数量 / 单价 / 小计 / 备注 / 操作
  - 小计实时计算（qty × unitPrice）
  - 单元格点击编辑（contenteditable + @blur 调 store.update）
-->
<template>
  <el-table
    :data="items"
    size="small"
    border
    stripe
    show-summary
    :summary-method="summaryRow"
    class="rounded"
    empty-text="暂无硬件项；点击上方「+ 新增硬件」添加。"
  >
    <el-table-column label="类别" min-width="120">
      <template #default="{ row }">
        <span
          class="block max-w-[120px] truncate"
          :title="typed(row).item.category"
          :contenteditable="editable"
          @blur="onEdit(typed(row).id, 'category', $event)"
        >{{ typed(row).item.category }}</span>
      </template>
    </el-table-column>
    <el-table-column label="设备" min-width="140">
      <template #default="{ row }">
        <span
          class="block max-w-[140px] truncate font-medium text-slate-900"
          :title="typed(row).item.device"
          :contenteditable="editable"
          @blur="onEdit(typed(row).id, 'device', $event)"
        >{{ typed(row).item.device }}</span>
      </template>
    </el-table-column>
    <el-table-column label="规格" min-width="160">
      <template #default="{ row }">
        <span
          class="block max-w-[160px] truncate"
          :title="typed(row).item.spec"
          :contenteditable="editable"
          @blur="onEdit(typed(row).id, 'spec', $event)"
        >{{ typed(row).item.spec }}</span>
      </template>
    </el-table-column>
    <el-table-column label="数量" width="100" align="right">
      <template #default="{ row }">
        <el-input-number
          v-if="editable"
          :model-value="typed(row).item.qty"
          :min="1"
          :step="1"
          size="small"
          controls-position="right"
          class="!w-24"
          @change="(v) => onNumberChange(typed(row).id, 'qty', v)"
        />
        <span v-else>{{ typed(row).item.qty }}</span>
      </template>
    </el-table-column>
    <el-table-column label="单价（元）" width="130" align="right">
      <template #default="{ row }">
        <el-input-number
          v-if="editable"
          :model-value="typed(row).item.unitPrice"
          :min="0"
          :step="0.01"
          :precision="2"
          size="small"
          controls-position="right"
          class="!w-32"
          @change="(v) => onNumberChange(typed(row).id, 'unitPrice', v)"
        />
        <span v-else>{{ formatCurrency(typed(row).item.unitPrice) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="小计（元）" width="120" align="right">
      <template #default="{ row }">
        <span class="tabular-nums text-slate-700">{{ formatCurrency(typed(row).item.subtotal) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="备注" min-width="180">
      <template #default="{ row }">
        <span
          class="block max-w-[180px] truncate"
          :title="typed(row).item.remarks"
          :contenteditable="editable"
          @blur="onEdit(typed(row).id, 'remarks', $event)"
        >{{ typed(row).item.remarks }}</span>
      </template>
    </el-table-column>
    <el-table-column v-if="editable" label="操作" width="100" align="right">
      <template #default="{ row }">
        <el-button link type="danger" size="small" @click="emit('delete', typed(row).id)">删除</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { HardwareItemDTO, HardwareItemInput } from "../api/hardware-items.api.ts";

const props = withDefaults(defineProps<{
  items: HardwareItemDTO[];
  editable?: boolean;
}>(), { editable: true });

const emit = defineEmits<{
  update: [id: string, patch: Partial<HardwareItemInput>];
  delete: [id: string];
}>();

const grandTotal = computed(() =>
  props.items.reduce((acc, it) => acc + (Number.isFinite(it.item.subtotal) ? it.item.subtotal : 0), 0)
);

function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "¥0";
  return `¥${n.toLocaleString("zh-Hans-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// el-table 的 #default slot 默认 row 类型是 DefaultRow（无业务字段）。cast helper。
const typed = (row: unknown): HardwareItemDTO => row as HardwareItemDTO;

// Element Plus 的 SummaryMethod<HardwareItemDTO> 类型签名与实际 columns 形状略有出入，
// 这里用一个宽松的实现：返回 string[] —— vue-tsc 不通过时用 as any 收口。
// deno-lint-ignore no-explicit-any
const summaryRow = ((args: { columns: { label?: string }[] }): string[] => {
  const sumCol = args.columns.findIndex((c) => c.label === "小计（元）");
  return args.columns.map((_c, i) => {
    if (i === 0) return "硬件合计";
    if (i === sumCol) return formatCurrency(grandTotal.value);
    return "";
  });
}) as any;

function onEdit(id: string, field: "category" | "device" | "spec" | "remarks", e: Event) {
  if (!props.editable) return;
  const target = e.target as HTMLElement;
  const value = (target.innerText ?? "").trim();
  emit("update", id, { [field]: value });
}

function onNumberChange(id: string, field: "qty" | "unitPrice", v: number | undefined) {
  if (!props.editable) return;
  if (v === undefined || !Number.isFinite(v)) return;
  if (field === "qty" && (!Number.isInteger(v) || v < 1)) return;
  if (field === "unitPrice" && v < 0) return;
  emit("update", id, { [field]: v });
}
</script>