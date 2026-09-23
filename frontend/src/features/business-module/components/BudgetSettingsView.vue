<!--
  BudgetSettingsView.vue
  ======================
  预算设置视图（阶段 7.4b）。
  - 4 个分组：工时基线 / 费用 / 比例 / 固定工时
  - 10 个 number input + 单位提示
  - 800ms debounce 自动保存
  - 错误：ratios ∈ [0,1]；其他数字 ≥ 0
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">成本计算设置</h2>
      <span class="text-xs" :class="dirty ? 'text-amber-700' : 'text-slate-500'">
        {{ dirty ? "保存中…" : saving ? "已保存" : "已同步" }}
      </span>
    </header>

    <p v-if="store.settingsError" class="text-xs text-red-300">{{ store.settingsError }}</p>
    <p v-if="localError" class="text-xs text-red-300">{{ localError }}</p>

    <div v-if="!form" class="text-xs text-slate-600">加载中…</div>
    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <!-- 1. 工时基线 -->
      <fieldset class="rounded border border-border p-3">
        <legend class="px-1 text-xs font-medium text-slate-700">工时基线</legend>
        <Field
          label="完成 1 CP 所需时间"
          unit="小时/CP"
          v-model.number="form.hoursPerCP"
          :min="0"
          step="0.5"
        />
        <Field
          label="每天平均投入时间"
          unit="小时/天"
          v-model.number="form.hoursPerDay"
          :min="0"
          step="0.5"
        />
      </fieldset>

      <!-- 2. 费用 -->
      <fieldset class="rounded border border-border p-3">
        <legend class="px-1 text-xs font-medium text-slate-700">费用</legend>
        <Field
          label="单价"
          unit="元/人日"
          v-model.number="form.unitPrice"
          :min="0"
          step="100"
        />
      </fieldset>

      <!-- 3. 比例（ratios ∈ [0, 1]）-->
      <fieldset class="rounded border border-border p-3">
        <legend class="px-1 text-xs font-medium text-slate-700">比例</legend>
        <Field label="需求分析占比" unit="0-1" v-model.number="form.reqAnalysisRatio" :min="0" :max="1" step="0.05" />
        <Field label="基本设计占比" unit="0-1" v-model.number="form.basicDesignRatio" :min="0" :max="1" step="0.05" />
        <Field label="测试占比" unit="0-1" v-model.number="form.testRatio" :min="0" :max="1" step="0.05" />
        <Field label="管理占比" unit="0-1" v-model.number="form.managementRatio" :min="0" :max="1" step="0.05" />
        <Field label="Buffer 占比" unit="0-1" v-model.number="form.bufferRatio" :min="0" :max="1" step="0.05" />
      </fieldset>

      <!-- 4. 固定工时 -->
      <fieldset class="rounded border border-border p-3">
        <legend class="px-1 text-xs font-medium text-slate-700">固定工时</legend>
        <Field label="部署工时" unit="人日" v-model.number="form.deployDays" :min="0" step="0.5" />
        <Field label="实施培训工时" unit="人日" v-model.number="form.trainingDays" :min="0" step="0.5" />
      </fieldset>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useBudgetStore } from "../stores/budget.store.ts";
import Field from "./SettingField.vue";
import type { BudgetSettingsDTO } from "../api/structured-modules.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useBudgetStore();

const form = ref<BudgetSettingsDTO | null>(null);
const saving = ref(false);
const dirty = ref(false);
const localError = ref<string | null>(null);
let timer: number | null = null;

onMounted(async () => {
  await store.loadSettings(props.projectId);
  const s = store.settingsByProject.get(props.projectId);
  if (s) form.value = { ...s };
});

// 深度 watch：form 任一字段改动触发 800ms debounce 自动保存
watch(
  form,
  (newVal) => {
    if (!newVal) return;
    dirty.value = true;
    localError.value = null;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const err = validate(newVal);
      if (err) {
        localError.value = err;
        dirty.value = false;
        return;
      }
      saving.value = true;
      try {
        const r = await store.saveSettings(props.projectId, newVal);
        if (r) form.value = { ...r };
      } finally {
        saving.value = false;
        dirty.value = false;
      }
    }, 800) as unknown as number;
  },
  { deep: true },
);

function validate(s: BudgetSettingsDTO): string | null {
  const ratios: [string, number][] = [
    ["reqAnalysisRatio", s.reqAnalysisRatio],
    ["basicDesignRatio", s.basicDesignRatio],
    ["testRatio", s.testRatio],
    ["managementRatio", s.managementRatio],
    ["bufferRatio", s.bufferRatio],
  ];
  for (const [k, v] of ratios) {
    if (v < 0 || v > 1) return `${k} 必须在 [0, 1] 范围`;
  }
  const nonNeg: [string, number][] = [
    ["hoursPerCP", s.hoursPerCP],
    ["hoursPerDay", s.hoursPerDay],
    ["unitPrice", s.unitPrice],
    ["deployDays", s.deployDays],
    ["trainingDays", s.trainingDays],
  ];
  for (const [k, v] of nonNeg) {
    if (v < 0) return `${k} 不能为负`;
  }
  return null;
}
</script>