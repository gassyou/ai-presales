<!--
  MonthlyChart.vue
  ================
  月度三系列柱状图（created / won / lost）+ 切换年份。

  纯 HTML + 内联 SVG —— 不引入第三方图表库（避免几十 KB 依赖）。
  三系列共用同一 Y 轴（maxAcrossAllMonths），柱条堆叠显示。
-->
<template>
  <div class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-800">月度统计</h2>
      <div class="flex items-center gap-2 text-xs">
        <button
          class="rounded border border-border px-2 py-0.5 text-slate-700 hover:bg-surface-alt disabled:opacity-40"
          :disabled="loading"
          @click="prevYear"
        >
          ‹
        </button>
        <span class="tabular-nums text-slate-600">{{ year }}</span>
        <button
          class="rounded border border-border px-2 py-0.5 text-slate-700 hover:bg-surface-alt disabled:opacity-40"
          :disabled="loading"
          @click="nextYear"
        >
          ›
        </button>
      </div>
    </header>

    <div v-if="loading" class="px-4 py-8 text-center text-xs text-slate-500">加载中…</div>
    <div v-else-if="stats.length === 0" class="px-4 py-8 text-center text-xs text-slate-500">暂无数据</div>
    <div v-else class="space-y-3">
      <!-- SVG 柱状图 -->
      <svg
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        class="h-48 w-full"
        preserveAspectRatio="none"
      >
        <!-- Y 轴基线 -->
        <line
          :x1="leftPad"
          :x2="chartWidth - rightPad"
          :y1="chartHeight - bottomPad"
          :y2="chartHeight - bottomPad"
          stroke="#334155"
          stroke-width="1"
        />

        <g v-for="(s, i) in stats" :key="s.month">
          <!-- created 柱 -->
          <rect
            :x="leftPad + i * (groupWidth + gap) + 1"
            :y="barY(s.created)"
            :width="barWidth"
            :height="barH(s.created)"
            fill="#38bdf8"
          >
            <title>{{ monthLabel(s.month) }} 新增 {{ s.created }}</title>
          </rect>
          <!-- won 柱 -->
          <rect
            :x="leftPad + i * (groupWidth + gap) + 1 + barWidth + 2"
            :y="barY(s.won)"
            :width="barWidth"
            :height="barH(s.won)"
            fill="#34d399"
          >
            <title>{{ monthLabel(s.month) }} 中标 {{ s.won }}</title>
          </rect>
          <!-- lost 柱 -->
          <rect
            :x="leftPad + i * (groupWidth + gap) + 1 + (barWidth + 2) * 2"
            :y="barY(s.lost)"
            :width="barWidth"
            :height="barH(s.lost)"
            fill="#f87171"
          >
            <title>{{ monthLabel(s.month) }} 未中标 {{ s.lost }}</title>
          </rect>
          <!-- X 轴标签 -->
          <text
            :x="leftPad + i * (groupWidth + gap) + groupWidth / 2"
            :y="chartHeight - bottomPad + 14"
            text-anchor="middle"
            font-size="10"
            fill="#94a3b8"
          >{{ s.month }}月</text>
        </g>
      </svg>

      <!-- 图例 -->
      <div class="flex items-center gap-4 text-xs text-slate-600">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-3 rounded-sm bg-sky-400" /> 新增
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-3 rounded-sm bg-emerald-400" /> 中标
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-3 rounded-sm bg-rose-400" /> 未中标
        </span>
      </div>

      <!-- 数字表 -->
      <table class="w-full text-xs">
        <thead>
          <tr class="text-slate-500">
            <th class="px-2 py-1 text-left">月份</th>
            <th class="px-2 py-1 text-right">新增</th>
            <th class="px-2 py-1 text-right">中标</th>
            <th class="px-2 py-1 text-right">未中标</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in stats" :key="s.month" class="border-t border-border">
            <td class="px-2 py-1 text-slate-700">{{ s.month }}月</td>
            <td class="px-2 py-1 text-right tabular-nums text-sky-700">{{ s.created }}</td>
            <td class="px-2 py-1 text-right tabular-nums text-emerald-700">{{ s.won }}</td>
            <td class="px-2 py-1 text-right tabular-nums text-rose-700">{{ s.lost }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MonthlyStat } from "../api/dashboard.api.ts";

const props = defineProps<{
  stats: MonthlyStat[];
  year: number;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "changeYear", year: number): void;
}>();

// ---------- 几何参数 ----------
const chartWidth = 720;
const chartHeight = 180;
const leftPad = 24;
const rightPad = 8;
const topPad = 8;
const bottomPad = 24;
const gap = 6;
// 每组 3 柱，每柱 12px → 组宽 ~42
const barWidth = 10;
const groupWidth = (barWidth + 2) * 3;

const maxAcrossAllMonths = computed(() => {
  const all = props.stats.flatMap((s) => [s.created, s.won, s.lost]);
  return Math.max(1, ...all);
});

function barY(v: number): number {
  const innerHeight = chartHeight - topPad - bottomPad;
  return topPad + innerHeight * (1 - v / maxAcrossAllMonths.value);
}
function barH(v: number): number {
  const innerHeight = chartHeight - topPad - bottomPad;
  return Math.max(0, innerHeight * (v / maxAcrossAllMonths.value));
}
function monthLabel(m: number): string {
  return `${m} 月`;
}

function prevYear(): void {
  emit("changeYear", props.year - 1);
}
function nextYear(): void {
  emit("changeYear", props.year + 1);
}
</script>
