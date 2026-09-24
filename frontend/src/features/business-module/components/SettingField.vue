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
    <el-input-number
      :model-value="modelValue"
      :min="min as number | undefined"
      :max="max as number | undefined"
      :step="step as number | undefined"
      class="mt-1"
      size="small"
      @update:model-value="(v) => onValueChange(v as number)"
    />
  </label>
</template>

<script setup lang="ts">
const props = withDefaults(
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

function onValueChange(v: number | undefined): void {
  const num = typeof v === "number" ? v : Number(v ?? 0);
  emit("update:modelValue", Number.isFinite(num) ? num : 0);
}
</script>