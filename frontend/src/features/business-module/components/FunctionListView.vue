<!--
  FunctionListView.vue
  ====================
  功能清单容器（阶段 7.4b）。
  - 顶部 6 汇总数字（实时计算：依赖 settings）
  - 过滤栏（分类 / 模块 / 功能名）
  - 视图切换：列表 / 脑图 / 卡片
  - 操作栏：新建 / AI 生成（占位）/ 导出 CSV
  - 内容区：动态渲染 3 个子视图
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">功能清单</h2>
      <div class="flex flex-wrap gap-2">
        <div class="flex rounded border border-border text-xs">
          <button
            v-for="m in ['table', 'mindmap', 'cards'] as const"
            :key="m"
            :class="viewMode === m ? 'bg-accent/20 text-accent' : 'text-slate-600 hover:bg-surface-alt'"
            class="px-2 py-1 first:rounded-l last:rounded-r"
            @click="viewMode = m"
          >{{ VIEW_LABEL[m] }}</button>
        </div>
        <button
          class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
          @click="openCreate"
        >新建功能</button>
        <button
          class="rounded border border-border px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt disabled:opacity-50"
          :disabled="aiGenerating"
          @click="onAiGenerate"
        >{{ aiGenerating ? "生成中…" : "AI 生成" }}</button>
        <button
          class="rounded border border-border px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt"
          @click="onExportCsv"
        >导出 CSV</button>
      </div>
    </header>

    <p v-if="store.functionError" class="text-xs text-red-300">{{ store.functionError }}</p>

    <!-- 顶部 6 汇总数字 -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <SummaryCell label="总 CP" :value="filteredTop.totalCP" suffix="" />
      <SummaryCell label="总工时 (h)" :value="filteredTop.totalEffortHours" suffix="h" :decimals="1" />
      <SummaryCell label="功能总金额" :value="filteredTop.functionTotalAmount" prefix="¥" />
      <SummaryCell label="部署培训金额" :value="filteredTop.deployTrainingAmount" prefix="¥" />
      <SummaryCell label="项目总金额（不含税）" :value="filteredTop.totalAmountExclTax" prefix="¥" highlight />
      <SummaryCell label="项目总工期 (天)" :value="filteredTop.totalPeriodDays" suffix="d" :decimals="1" />
    </div>

    <!-- 过滤栏 -->
    <div class="flex flex-wrap gap-2 text-xs">
      <input
        v-model="filterCategory"
        class="rounded border border-border bg-surface-alt px-2 py-1 text-slate-800"
        placeholder="分类筛选"
      />
      <input
        v-model="filterModule"
        class="rounded border border-border bg-surface-alt px-2 py-1 text-slate-800"
        placeholder="模块筛选"
      />
      <input
        v-model="filterName"
        class="rounded border border-border bg-surface-alt px-2 py-1 text-slate-800"
        placeholder="功能名筛选"
      />
    </div>

    <div v-if="items.length === 0" class="rounded border border-border bg-white/50 p-4 text-xs text-slate-600">
      暂无功能。点击「新建功能」开始。
    </div>

    <!-- 视图区 -->
    <FunctionListTable
      v-else-if="viewMode === 'table'"
      :items="filtered"
      @edit="openEdit"
      @delete="onDelete"
      @toggle-scope="onToggleScope"
      @change-cp="onChangeCp"
      @cell-edit="onCellEdit"
    />
    <FunctionListMindmap
      v-else-if="viewMode === 'mindmap'"
      :items="filtered"
      @toggle-scope="onToggleScope"
      @change-cp="onChangeCp"
    />
    <FunctionListCards
      v-else
      :items="filtered"
      @edit="openEdit"
      @delete="onDelete"
      @toggle-scope="onToggleScope"
    />

    <!-- 新建 / 编辑抽屉 -->
    <div
      v-if="editing"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4"
      @click.self="cancelEdit"
    >
      <div class="w-full max-w-xl rounded border border-border bg-white p-4 shadow-xl">
        <h3 class="mb-3 text-sm font-medium text-slate-800">
          {{ editing.id ? "编辑功能" : "新建功能" }}
        </h3>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs text-slate-600">分类</span>
            <input v-model="editing.category" class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800" placeholder="订单" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-600">模块</span>
            <input v-model="editing.module" class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800" placeholder="下单" />
          </label>
        </div>
        <label class="mt-2 block">
          <span class="text-xs text-slate-600">功能名 *</span>
          <input v-model="editing.name" class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800" />
        </label>
        <label class="mt-2 block">
          <span class="text-xs text-slate-600">功能详细</span>
          <textarea v-model="editing.detail" rows="3" class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800" />
        </label>
        <label class="mt-2 block">
          <span class="text-xs text-slate-600">备注</span>
          <textarea v-model="editing.remarks" rows="2" class="mt-1 w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800" />
        </label>
        <div class="mt-2 flex items-center gap-3">
          <label class="block">
            <span class="text-xs text-slate-600">CP</span>
            <select v-model.number="editing.cp" class="mt-1 rounded border border-border bg-surface-alt p-2 text-xs text-slate-800">
              <option :value="0">未设</option>
              <option v-for="cp in CP_VALUES" :key="cp" :value="cp">{{ cp }}</option>
            </select>
          </label>
          <label class="mt-3 flex items-center gap-1 text-xs text-slate-700">
            <input v-model="editing.inScope" type="checkbox" />
            项目范围内
          </label>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <button class="rounded border border-border px-3 py-1 text-xs text-slate-700 hover:bg-surface-alt" @click="cancelEdit">取消</button>
          <button
            class="rounded border border-accent/50 px-3 py-1 text-xs text-accent hover:bg-accent/10"
            :disabled="saving"
            @click="onSave"
          >{{ saving ? "保存中…" : "保存" }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useBudgetStore } from "../stores/budget.store.ts";
import { CP_VALUES, structuredModulesApi, type FunctionListInput } from "../api/structured-modules.api.ts";
import FunctionListTable from "./FunctionListTable.vue";
import FunctionListMindmap from "./FunctionListMindmap.vue";
import FunctionListCards from "./FunctionListCards.vue";
import SummaryCell from "./SummaryCell.vue";
import {
  computeTopSummary,
} from "@backend/domain/business-module/budget-summary.ts";
import type { FunctionListDTO } from "../api/structured-modules.api.ts";
import type { FunctionListPayload } from "@backend/domain/business-module/function-list.ts";
import {
  DEFAULT_BUDGET_SETTINGS,
} from "@backend/domain/business-module/budget-settings.ts";

const props = defineProps<{ projectId: string }>();
const store = useBudgetStore();

const VIEW_LABEL: Record<string, string> = { table: "列表", mindmap: "脑图", cards: "卡片" };
type ViewMode = "table" | "mindmap" | "cards";
const viewMode = ref<ViewMode>("table");

const items = computed<FunctionListDTO[]>(() => store.functionsByProject.get(props.projectId) ?? []);

const filterCategory = ref("");
const filterModule = ref("");
const filterName = ref("");

const filtered = computed<FunctionListDTO[]>(() =>
  items.value.filter((it) =>
    (!filterCategory.value || it.category.includes(filterCategory.value)) &&
    (!filterModule.value || it.module.includes(filterModule.value)) &&
    (!filterName.value || it.name.includes(filterName.value)),
  ),
);

// 顶部汇总：基于过滤后 + in-scope 计算（与服务端同款纯函数）
const settings = computed(() => store.settingsByProject.get(props.projectId) ?? DEFAULT_BUDGET_SETTINGS);

const filteredTop = computed(() => {
  const fns: FunctionListPayload[] = filtered.value.map((it) => ({
    category: it.category,
    module: it.module,
    name: it.name,
    detail: it.detail,
    remarks: it.remarks,
    cp: (it.cp as FunctionListPayload["cp"]),
    inScope: it.inScope,
  }));
  return computeTopSummary(fns, settings.value);
});

const editing = ref<(FunctionListInput & { id: string }) | null>(null);
const saving = ref(false);
const aiGenerating = ref(false);

onMounted(async () => {
  await Promise.all([store.loadFunctions(props.projectId), store.loadSettings(props.projectId)]);
});

function openCreate(): void {
  editing.value = { id: "", category: "", module: "", name: "", detail: "", remarks: "", cp: 0, inScope: true };
}

function openEdit(it: FunctionListDTO): void {
  editing.value = {
    id: it.id,
    category: it.category,
    module: it.module,
    name: it.name,
    detail: it.detail,
    remarks: it.remarks,
    cp: it.cp,
    inScope: it.inScope,
  };
}

function cancelEdit(): void {
  editing.value = null;
}

async function onSave(): Promise<void> {
  const ed = editing.value;
  if (!ed) return;
  saving.value = true;
  try {
    const body: FunctionListInput = {
      category: ed.category,
      module: ed.module,
      name: ed.name,
      detail: ed.detail,
      remarks: ed.remarks,
      cp: ed.cp,
      inScope: ed.inScope,
    };
    if (ed.id) {
      await store.updateFunction(props.projectId, ed.id, body);
    } else {
      await store.createFunction(props.projectId, body);
    }
    editing.value = null;
  } finally {
    saving.value = false;
  }
}

async function onDelete(id: string): Promise<void> {
  if (!confirm("确认删除？")) return;
  await store.deleteFunction(props.projectId, id);
}

async function onToggleScope(it: FunctionListDTO): Promise<void> {
  await store.updateFunction(props.projectId, it.id, { inScope: !it.inScope });
}

async function onCellEdit(
  it: FunctionListDTO,
  field: "category" | "module" | "name" | "detail" | "remarks",
  value: string,
): Promise<void> {
  await store.updateFunction(props.projectId, it.id, { [field]: value } as Partial<FunctionListInput>);
}

async function onChangeCp(it: FunctionListDTO, cp: number): Promise<void> {
  await store.updateFunction(props.projectId, it.id, { cp });
}

async function onAiGenerate(): Promise<void> {
  // 阶段 7.5（H1）：真调后端 AI 一键生成（markdown-author sub-agent）；后端失败 → 弹提示，不阻塞 UI
  if (aiGenerating.value) return;
  aiGenerating.value = true;
  try {
    const prompt = window.prompt("补充你想强调的功能点 / 行业 / 受众（可留空）：", "") ?? undefined;
    await structuredModulesApi.batchFromSubAgent(props.projectId, { prompt, count: 6 });
    await store.loadFunctions(props.projectId);
  } catch (e) {
    window.alert(`AI 生成失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    aiGenerating.value = false;
  }
}

function onExportCsv(): void {
  // 仅 in-scope + 不含 CP/工时/金额（按文档）
  const rows = items.value.filter((it) => it.inScope);
  const header = ["分类", "模块", "功能名", "功能详细", "备注"];
  const lines = [header.join(",")];
  for (const it of rows) {
    lines.push([
      csv(it.category),
      csv(it.module),
      csv(it.name),
      csv(it.detail),
      csv(it.remarks),
    ].join(","));
  }
  const csv_text = "﻿" + lines.join("\n"); // UTF-8 BOM
  const blob = new Blob([csv_text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `功能清单-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
</script>