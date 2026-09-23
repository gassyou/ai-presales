<!--
  BudgetSummaryView.vue
  =====================
  预算汇总视图（阶段 7.4b）。
  - 顶部 6 个汇总数字
  - "按模块" 表 + 部署/培训/Buffer/合计 footer（黄底合计）
  - "按开发阶段" 9 行表（顺序固定）
  - 操作栏：导出 Excel（xlsx → 简单 CSV 兜底）
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">预算汇总</h2>
      <div class="flex gap-2">
        <button
          class="rounded border border-border px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt"
          @click="onReload"
        >刷新</button>
        <button
          class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
          @click="onExport"
        >导出 Excel</button>
      </div>
    </header>

    <p v-if="store.summaryError" class="text-xs text-red-300">{{ store.summaryError }}</p>
    <p v-if="!summary" class="text-xs text-slate-600">加载中…</p>

    <template v-if="summary">
      <!-- 顶部 6 汇总 -->
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCell label="总 CP" :value="summary.top.totalCP" />
        <SummaryCell label="总工时 (h)" :value="summary.top.totalEffortHours" suffix="h" :decimals="1" />
        <SummaryCell label="功能总金额" :value="summary.top.functionTotalAmount" prefix="¥" />
        <SummaryCell label="部署培训金额" :value="summary.top.deployTrainingAmount" prefix="¥" />
        <SummaryCell label="项目总金额（不含税）" :value="summary.top.totalAmountExclTax" prefix="¥" highlight />
        <SummaryCell label="项目总工期 (天)" :value="summary.top.totalPeriodDays" suffix="d" :decimals="1" />
      </div>

      <!-- 按模块 -->
      <div>
        <h3 class="mb-2 text-xs font-medium text-slate-600">按模块</h3>
        <div class="overflow-x-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-surface-alt/60 text-slate-700">
              <tr>
                <th class="px-2 py-2 text-left">分类</th>
                <th class="px-2 py-2 text-left">模块</th>
                <th class="px-2 py-2 text-right">人日</th>
                <th class="px-2 py-2 text-right">金额</th>
                <th class="px-2 py-2 text-right">工期(天)</th>
                <th class="px-2 py-2 text-right">工期(月)</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, idx) in summary.byModule.rows"
                :key="`${r.category}/${r.module}/${idx}`"
                class="border-t border-border hover:bg-surface-alt/30"
              >
                <td class="px-2 py-1">{{ r.category || "—" }}</td>
                <td class="px-2 py-1">{{ r.module || "—" }}</td>
                <td class="px-2 py-1 text-right">{{ r.manDays.toFixed(2) }}</td>
                <td class="px-2 py-1 text-right">¥{{ Math.round(r.amount).toLocaleString() }}</td>
                <td class="px-2 py-1 text-right">{{ r.periodDays.toFixed(2) }}</td>
                <td class="px-2 py-1 text-right">{{ r.periodMonths.toFixed(2) }}</td>
              </tr>
              <FooterRow :row="summary.byModule.deploy" label="部署" />
              <FooterRow :row="summary.byModule.training" label="实施培训" />
              <FooterRow :row="summary.byModule.buffer" label="Buffer" />
              <FooterRow :row="summary.byModule.total" label="合计" highlight />
            </tbody>
          </table>
        </div>
      </div>

      <!-- 按开发阶段 -->
      <div>
        <h3 class="mb-2 text-xs font-medium text-slate-600">按开发阶段</h3>
        <div class="overflow-x-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-surface-alt/60 text-slate-700">
              <tr>
                <th class="px-2 py-2 text-left">阶段</th>
                <th class="px-2 py-2 text-right">人日</th>
                <th class="px-2 py-2 text-right">金额</th>
                <th class="px-2 py-2 text-right">工期(天)</th>
                <th class="px-2 py-2 text-right">工期(月)</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, idx) in summary.byPhase"
                :key="`${r.phase}/${idx}`"
                :class="[
                  'border-t border-border',
                  r.phase === '合计' ? 'bg-accent/10 font-semibold text-accent' : 'hover:bg-surface-alt/30',
                ]"
              >
                <td class="px-2 py-1">{{ r.phase }}</td>
                <td class="px-2 py-1 text-right">{{ r.manDays.toFixed(2) }}</td>
                <td class="px-2 py-1 text-right">¥{{ Math.round(r.amount).toLocaleString() }}</td>
                <td class="px-2 py-1 text-right">{{ r.periodDays.toFixed(2) }}</td>
                <td class="px-2 py-1 text-right">{{ r.periodMonths.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useBudgetStore } from "../stores/budget.store.ts";
import SummaryCell from "./SummaryCell.vue";
import FooterRow from "./FooterRow.vue";
import type { ModuleBudgetRowDTO } from "../api/structured-modules.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useBudgetStore();

const summary = computed(() => store.summaryByProject.get(props.projectId));

onMounted(async () => {
  await store.loadSummary(props.projectId);
});

async function onReload(): Promise<void> {
  await store.loadSummary(props.projectId);
}

function onExport(): void {
  const s = summary.value;
  if (!s) return;
  // 简单 CSV 实现（Excel 通过 xlsx 库或 Office 365 直接打开 BOM UTF-8 即可）
  // 为避免引入 xlsx 库，此处输出 CSV；可后续替换为 xlsx 流
  const lines: string[] = [];
  lines.push("类型,分类,模块/阶段,人日,金额,工期(天),工期(月)");
  for (const r of s.byModule.rows) lines.push(csvRow("模块", r));
  lines.push(csvRow("模块", s.byModule.deploy, "部署"));
  lines.push(csvRow("模块", s.byModule.training, "实施培训"));
  lines.push(csvRow("模块", s.byModule.buffer, "Buffer"));
  lines.push(csvRow("模块", s.byModule.total, "合计"));
  for (const r of s.byPhase) {
    lines.push(csvRow("阶段", {
      category: "",
      module: r.phase,
      manDays: r.manDays,
      amount: r.amount,
      periodDays: r.periodDays,
      periodMonths: r.periodMonths,
    }, r.phase));
  }

  const csv_text = "﻿" + lines.join("\n");
  const blob = new Blob([csv_text], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `预算汇总-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvRow(kind: string, r: ModuleBudgetRowDTO, overrideLabel?: string): string {
  const label = overrideLabel ?? (kind === "模块" ? r.module : "");
  return [
    kind,
    csv(kind === "模块" ? r.category : ""),
    csv(label),
    r.manDays.toFixed(2),
    Math.round(r.amount).toString(),
    r.periodDays.toFixed(2),
    r.periodMonths.toFixed(2),
  ].join(",");
}

function csv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
</script>