<!--
  SummaryCell.vue
  ===============
  顶部汇总数字块（阶段 7.4b）。
-->
<template>
  <div
    :class="[
      'rounded border p-2',
      highlight ? 'border-accent/60 bg-accent/10' : 'border-border bg-white/40',
    ]"
  >
    <div class="text-[10px] uppercase text-slate-600">{{ label }}</div>
    <div :class="['mt-1 font-semibold', highlight ? 'text-accent' : 'text-slate-900']">
      {{ prefix }}{{ formattedValue }}{{ suffix }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    highlight?: boolean;
  }>(),
  { decimals: 0, prefix: "", suffix: "", highlight: false },
);

const formattedValue = computed(() => {
  const v = props.value;
  if (Number.isNaN(v) || !Number.isFinite(v)) return "0";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  });
});
</script>