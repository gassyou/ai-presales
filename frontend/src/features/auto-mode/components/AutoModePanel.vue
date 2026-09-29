<!--
  AutoModePanel.vue
  =================
  阶段 13（PR #9）：auto-mode 全流水线触发面板。

  位置：项目详情页底部，AI chat 旁边。
  交互：
    - 用户点击「🚀 启动 auto-mode」
    - 调 store.run(projectId) → 后端 orchestrator.run(plan)
    - 完成后显示：成功/失败、每个 task 评分轮次、平均分、最终产出 markdown 摘录
-->
<template>
  <div class="rounded-xl border border-border bg-white p-3 shadow-card">
    <div class="mb-2 flex items-center justify-between">
      <div class="text-sm font-semibold text-slate-800">auto-mode 全流水线</div>
      <span
        v-if="store.lastResult"
        class="rounded px-2 py-0.5 text-[10px] font-semibold"
        :class="store.lastResult.success ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'"
      >
        {{ store.lastResult.success ? "全部通过" : "部分失败" }}
      </span>
    </div>

    <p class="mb-2 text-xs leading-5 text-slate-500">
      一键跑完：环境初始化 → 业务需求专家（设计调查问卷 + 业务现状 + 问题点 + 改善目标）。
      每个任务都经客户视角 + 售前总监视角双轮评审，未通过自动重试。
    </p>

    <el-button
      type="primary"
      size="small"
      :loading="store.running"
      :disabled="!projectId"
      @click="onRun"
    >
      <span class="mr-1">🚀</span>
      {{ store.running ? "执行中…" : "启动 auto-mode" }}
    </el-button>

    <div v-if="store.lastError" class="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
      {{ store.lastError }}
    </div>

    <div v-if="store.lastResult" class="mt-3 space-y-2 text-xs">
      <div class="text-slate-500">
        总耗时：{{ (store.lastResult.totalMs / 1000).toFixed(1) }}s ·
        任务数：{{ store.lastResult.taskResults.length }}
      </div>
      <div
        v-for="t in store.lastResult.taskResults"
        :key="t.taskName"
        class="rounded border border-border bg-surface-sunken/40 p-2"
      >
        <div class="mb-1 flex items-center justify-between">
          <span class="font-semibold text-slate-700">{{ taskDisplayName(t.taskName) }}</span>
          <span
            class="rounded px-1.5 py-0.5 text-[10px]"
            :class="t.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'"
          >
            {{ t.passed ? `✓ 通过 (${t.rounds}轮)` : `✗ 未通过 (${t.rounds}轮)` }}
          </span>
        </div>
        <div v-if="t.reviews.length > 0" class="space-y-1 text-[11px] text-slate-600">
          <div
            v-for="r in t.reviews"
            :key="r.round"
            class="flex items-center gap-2"
          >
            <span class="text-slate-400">第{{ r.round }}轮</span>
            <span>客户 {{ r.customerScore }}</span>
            <span>总监 {{ r.directorScore }}</span>
            <span class="font-semibold">均分 {{ r.average.toFixed(1) }}</span>
          </div>
        </div>
        <details v-if="t.output" class="mt-1">
          <summary class="cursor-pointer text-[10px] text-slate-500 hover:text-slate-700">
            输出（首 200 字）
          </summary>
          <pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">{{ t.output.slice(0, 200) }}{{ t.output.length > 200 ? "…" : "" }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAutoModeStore } from "../stores/auto-mode.store.ts";

const props = defineProps<{ projectId: string | null }>();
const store = useAutoModeStore();

const DISPLAY_NAMES: Record<string, string> = {
  env_init: "环境初始化",
  business_requirements: "业务需求分析",
};
function taskDisplayName(name: string): string {
  return DISPLAY_NAMES[name] ?? name;
}

async function onRun(): Promise<void> {
  if (!props.projectId) return;
  await store.run(props.projectId);
}
</script>