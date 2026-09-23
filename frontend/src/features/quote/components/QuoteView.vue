<!--
  QuoteView.vue
  =============
  报价单视图容器（阶段 7.4f）。
  - 顶部 6 汇总数字（软件 + 部署培训 + 硬件 + 合计）
  - 嵌入硬件清单只读视图
  - 历史区表格
  - 顶部「生成报价单」按钮 → 打开 QuoteAiDraftDialog
-->
<template>
  <header class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-slate-800">报价单</h2>
      <p class="text-xs text-slate-600">基于功能分析 + 硬件清单自动派生；选模板生成 Excel</p>
    </div>
    <button
      class="rounded bg-sky-700/60 px-3 py-1 text-xs text-sky-100 hover:bg-sky-700"
      @click="openGenerate"
    >生成报价单</button>
  </header>

  <div v-if="error" class="rounded border border-rose-700 bg-rose-50 px-3 py-2 text-xs text-rose-700">
    {{ error }}
  </div>

  <!-- 顶部 6 汇总 -->
  <div class="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
    <SummaryCell label="总 CP" :value="snapshot?.top.totalCP ?? 0" />
    <SummaryCell label="总工时(h)" :value="snapshot?.top.totalEffortHours ?? 0" />
    <SummaryCell label="软件金额(元)" :value="snapshot?.software.subtotal ?? 0" currency />
    <SummaryCell label="部署培训(元)" :value="snapshot?.deployTraining.subtotal ?? 0" currency />
    <SummaryCell label="硬件合计(元)" :value="snapshot?.hardware.subtotal ?? 0" currency />
    <SummaryCell label="总金额(不含税)" :value="snapshot?.grandTotalExclTax ?? 0" currency highlight />
  </div>

  <!-- 硬件清单只读 -->
  <section class="rounded border border-border bg-white/50 p-3">
    <h3 class="mb-2 text-xs font-medium text-slate-700">硬件清单</h3>
    <HardwareItemsTable
      :items="hardwareItems"
      :editable="false"
    />
  </section>

  <!-- 历史 -->
  <section class="rounded border border-border bg-white/50 p-3">
    <h3 class="mb-2 text-xs font-medium text-slate-700">历史报价单</h3>
    <div v-if="runs.length === 0" class="py-4 text-center text-xs text-slate-500">
      暂无生成历史。
    </div>
    <table v-else class="w-full text-xs">
      <thead class="bg-surface-alt/60 text-slate-600">
        <tr>
          <th class="px-2 py-1 text-left">生成时间</th>
          <th class="px-2 py-1 text-left">模板</th>
          <th class="px-2 py-1 text-left">输入</th>
          <th class="px-2 py-1 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in runs" :key="r.id" class="border-t border-border">
          <td class="px-2 py-1 tabular-nums text-slate-700">{{ formatDate(r.createdAt) }}</td>
          <td class="px-2 py-1 text-slate-700">{{ r.templateFilename ?? "内置默认" }}</td>
          <td class="max-w-[200px] truncate px-2 py-1 text-slate-600" :title="r.userInput">
            {{ r.userInput || "—" }}
          </td>
          <td class="px-2 py-1 text-right">
            <a
              :href="quoteApi.downloadUrl(projectId, r.id)"
              class="rounded bg-sky-700/60 px-2 py-0.5 text-sky-100 hover:bg-sky-700"
              download
            >下载</a>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <!-- 生成弹窗 -->
  <QuoteAiDraftDialog
    ref="dialogRef"
    :open="dialogOpen"
    :project-id="projectId"
    :templates="templates"
    @close="dialogOpen = false"
    @generate="onGenerate"
    @upload="onUpload"
  />
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import SummaryCell from "@frontend/features/business-module/components/SummaryCell.vue";
import HardwareItemsTable from "@frontend/features/business-module/components/HardwareItemsTable.vue";
import QuoteAiDraftDialog from "./QuoteAiDraftDialog.vue";
import { useQuoteStore } from "../stores/quote.store.ts";
import { useHardwareItemsStore } from "@frontend/features/business-module/stores/hardware-items.store.ts";
import { useQuoteComposerStore } from "../stores/quote-composer.store.ts";
import { quoteApi } from "../api/quote.api.ts";

const props = defineProps<{ projectId: string }>();
const quoteStore = useQuoteStore();
const hwStore = useHardwareItemsStore();
const composerStore = useQuoteComposerStore();

const dialogOpen = ref(false);
const dialogRef = ref<InstanceType<typeof QuoteAiDraftDialog> | null>(null);

const snapshot = computed(() => quoteStore.getSnapshot(props.projectId));
const templates = computed(() => quoteStore.getTemplates(props.projectId));
const runs = computed(() => quoteStore.getRuns(props.projectId));
const error = computed(() => quoteStore.error);

const hardwareItems = computed(() => hwStore.getItems(props.projectId));

onMounted(async () => {
  await Promise.all([
    quoteStore.loadSnapshot(props.projectId),
    quoteStore.loadTemplates(props.projectId),
    quoteStore.loadRuns(props.projectId),
    hwStore.load(props.projectId),
  ]);
});

// 阶段 7.4f：监听全局浮动按钮（仅当匹配当前项目时打开）
watch(
  () => [composerStore.open, composerStore.projectId] as const,
  ([open, pid]) => {
    if (open && pid === props.projectId) {
      dialogOpen.value = true;
      composerStore.close();
    }
  },
);

function openGenerate() {
  dialogOpen.value = true;
}

async function onGenerate(args: { templateId?: string; userInput: string; aiMarkdown?: string }) {
  const r = await quoteStore.generate(props.projectId, args);
  if (r) {
    dialogRef.value?.setResult(r);
  } else {
    dialogRef.value?.setError(quoteStore.error ?? "生成失败");
  }
}

async function onUpload(file: File) {
  await quoteStore.uploadTemplate(props.projectId, file);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-Hans-CN");
  } catch {
    return iso;
  }
}
</script>