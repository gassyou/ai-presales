<!--
  SettingField.vue
  ===============
  设置项：标签 + number input + 单位提示（阶段 7.4b）。
-->
<template>
  <label class="mb-2 block last:mb-0">
    <div class="flex items-baseline justify-between">
      <span class="text-xs text-slate-700">{{ label }}</span>
      <span class="text-[10px] text-slate-500">{{ unit }}</span>
    </div>
    <input
      type="number"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-xs text-slate-800"
      @input="onInput"
    />
  </label>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    unit: string;
    modelValue: number;
    min?: number | string;
    max?: number | string;
    step?: number | string;
  }>(),
  { min: undefined, max: undefined, step: 0.1 },
);
const emit = defineEmits<{
  (e: "update:modelValue", v: number): void;
}>();

function onInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  emit("update:modelValue", Number.isFinite(v) ? v : 0);
}
</script>