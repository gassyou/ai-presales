<!--
  FooterRow.vue
  =============
  按模块表的 footer 行（部署/培训/Buffer/合计）。
  - 把 label 放在第 2 列（模块列），第 1 列空
-->
<template>
  <tr
    :class="[
      'border-t border-border',
      highlight ? 'bg-accent/10 font-semibold text-accent' : 'bg-surface-alt/40 text-slate-700',
    ]"
  >
    <td class="px-2 py-1"></td>
    <td class="px-2 py-1">{{ label }}</td>
    <td class="px-2 py-1 text-right">{{ row.manDays.toFixed(2) }}</td>
    <td class="px-2 py-1 text-right">¥{{ Math.round(row.amount).toLocaleString() }}</td>
    <td class="px-2 py-1 text-right">{{ row.periodDays.toFixed(2) }}</td>
    <td class="px-2 py-1 text-right">{{ row.periodMonths.toFixed(2) }}</td>
  </tr>
</template>

<script setup lang="ts">
import type { ModuleBudgetRowDTO } from "../api/structured-modules.api.ts";

withDefaults(
  defineProps<{ row: ModuleBudgetRowDTO; label: string; highlight?: boolean }>(),
  { highlight: false },
);
</script>