<!--
  HardwareItemsTable.vue
  ======================
  硬件设备清单表格（阶段 7.4f）。
  - 每行：类别 / 设备 / 规格 / 数量 / 单价 / 小计 / 备注 / 操作
  - 小计实时计算（qty × unitPrice）
  - 单元格点击编辑（contenteditable + @blur 调 store.update）
-->
<template>
  <div class="overflow-x-auto rounded border border-border">
    <table class="w-full text-xs">
      <thead class="bg-surface-alt/60 text-slate-700">
        <tr>
          <th class="px-2 py-2 text-left">类别</th>
          <th class="px-2 py-2 text-left">设备</th>
          <th class="px-2 py-2 text-left">规格</th>
          <th class="px-2 py-2 text-right">数量</th>
          <th class="px-2 py-2 text-right">单价（元）</th>
          <th class="px-2 py-2 text-right">小计（元）</th>
          <th class="px-2 py-2 text-left">备注</th>
          <th class="px-2 py-2 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="items.length === 0">
          <td colspan="8" class="px-3 py-6 text-center text-slate-500">
            暂无硬件项；点击上方「+ 新增硬件」添加。
          </td>
        </tr>
        <tr
          v-for="it in items"
          :key="it.id"
          class="border-t border-border hover:bg-surface-alt/30"
        >
          <td class="px-2 py-1">
            <span
              class="block max-w-[120px] truncate"
              :title="it.item.category"
              :contenteditable="editable"
              @blur="onEdit(it.id, 'category', $event)"
            >{{ it.item.category }}</span>
          </td>
          <td class="px-2 py-1">
            <span
              class="block max-w-[140px] truncate font-medium text-slate-900"
              :title="it.item.device"
              :contenteditable="editable"
              @blur="onEdit(it.id, 'device', $event)"
            >{{ it.item.device }}</span>
          </td>
          <td class="px-2 py-1">
            <span
              class="block max-w-[160px] truncate"
              :title="it.item.spec"
              :contenteditable="editable"
              @blur="onEdit(it.id, 'spec', $event)"
            >{{ it.item.spec }}</span>
          </td>
          <td class="px-2 py-1 text-right">
            <input
              v-if="editable"
              type="number"
              min="1"
              step="1"
              class="w-16 rounded border border-border bg-white px-1 text-right text-xs"
              :value="it.item.qty"
              @change="onEditNumber(it.id, 'qty', $event)"
            />
            <span v-else>{{ it.item.qty }}</span>
          </td>
          <td class="px-2 py-1 text-right">
            <input
              v-if="editable"
              type="number"
              min="0"
              step="0.01"
              class="w-24 rounded border border-border bg-white px-1 text-right text-xs"
              :value="it.item.unitPrice"
              @change="onEditNumber(it.id, 'unitPrice', $event)"
            />
            <span v-else>{{ formatCurrency(it.item.unitPrice) }}</span>
          </td>
          <td class="px-2 py-1 text-right tabular-nums text-slate-700">
            {{ formatCurrency(it.item.subtotal) }}
          </td>
          <td class="px-2 py-1">
            <span
              class="block max-w-[180px] truncate"
              :title="it.item.remarks"
              :contenteditable="editable"
              @blur="onEdit(it.id, 'remarks', $event)"
            >{{ it.item.remarks }}</span>
          </td>
          <td class="px-2 py-1 text-right">
            <button
              v-if="editable"
              class="rounded bg-rose-700/40 px-2 py-0.5 text-xs text-rose-100 hover:bg-rose-700"
              @click="$emit('delete', it.id)"
            >删除</button>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="items.length > 0">
        <tr class="border-t border-border bg-surface-alt/40 font-semibold">
          <td colspan="5" class="px-2 py-1 text-right">硬件合计</td>
          <td class="px-2 py-1 text-right tabular-nums">{{ formatCurrency(grandTotal) }}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
  </div>
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

function onEdit(id: string, field: "category" | "device" | "spec" | "remarks", e: Event) {
  if (!props.editable) return;
  const target = e.target as HTMLElement;
  const value = (target.innerText ?? "").trim();
  emit("update", id, { [field]: value });
}

function onEditNumber(id: string, field: "qty" | "unitPrice", e: Event) {
  if (!props.editable) return;
  const target = e.target as HTMLInputElement;
  const num = Number(target.value);
  if (!Number.isFinite(num)) return;
  if (field === "qty" && (!Number.isInteger(num) || num < 1)) return;
  if (field === "unitPrice" && num < 0) return;
  emit("update", id, { [field]: num });
}
</script>