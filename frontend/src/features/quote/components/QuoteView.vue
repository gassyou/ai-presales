<!--
  QuoteView.vue
  =============
  报价单生成器（阶段 7.4f 重构）。

  形态：勾选式选择要在 Excel 中包含的项目：
    - 功能费用（含 2 子选项：按模块列出 / 按开发阶段列出 + Buffer 分摊）
    - 硬件费用
    - 前提条件
    - 交付物清单
    - 功能清单
  点「生成报价单」→ 收集勾选 + 子选项 → 调后端 QuoteAiDraftDialog 生成 Excel。
  具体导出功能暂不实现。
-->
<template>
  <section class="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-slate-800">报价单</h2>
        <p class="text-xs text-slate-600">勾选要在 Excel 中包含的内容；点「生成报价单」</p>
      </div>
      <button
        class="rounded bg-sky-700/60 px-3 py-1 text-xs text-sky-100 hover:bg-sky-700 disabled:opacity-40"
        :disabled="!hasAnySelection"
        @click="openGenerate"
      >生成报价单</button>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

    <!-- 顶部 6 汇总（保留） -->
    <div class="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
      <SummaryCell label="总 CP" :value="snapshot?.top.totalCP ?? 0" />
      <SummaryCell label="总工时(h)" :value="snapshot?.top.totalEffortHours ?? 0" />
      <SummaryCell label="软件金额(元)" :value="snapshot?.software.subtotal ?? 0" currency />
      <SummaryCell label="部署培训(元)" :value="snapshot?.deployTraining.subtotal ?? 0" currency />
      <SummaryCell label="硬件合计(元)" :value="snapshot?.hardware.subtotal ?? 0" currency />
      <SummaryCell label="总金额(不含税)" :value="snapshot?.grandTotalExclTax ?? 0" currency highlight />
    </div>

    <!-- 勾选式生成器 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <div class="rounded border border-border bg-white/50 p-3">
        <h3 class="mb-2 text-xs font-medium text-slate-700">要包含在 Excel 中的内容</h3>
        <ul class="space-y-2 text-xs text-slate-700">
          <!-- 功能费用（含子选项） -->
          <li>
            <label class="flex items-center gap-2">
              <el-checkbox v-model="opts.includeFunctionCost" />
              <span class="font-medium">功能费用</span>
            </label>
            <div v-if="opts.includeFunctionCost" class="ml-6 mt-2 space-y-2 rounded bg-surface-alt/30 p-2">
              <label class="flex items-center gap-2">
                <el-radio v-model="opts.functionCostGrouping" value="byModule">按模块列出</el-radio>
                <el-radio v-model="opts.functionCostGrouping" value="byStage">按开发阶段列出</el-radio>
              </label>
              <label class="flex items-center gap-2">
                <el-checkbox v-model="opts.bufferAllocated">Buffer 费用分摊到各项明细</el-checkbox>
              </label>
            </div>
          </li>

          <li>
            <label class="flex items-center gap-2">
              <el-checkbox v-model="opts.includeHardware" />
              <span class="font-medium">硬件费用</span>
              <span class="text-slate-500" v-if="opts.includeHardware">
                （共 {{ hardwareItems.length }} 项，合计 ¥{{ hardwareTotal.toLocaleString() }}）
              </span>
            </label>
          </li>

          <li>
            <label class="flex items-center gap-2">
              <el-checkbox v-model="opts.includePrecondition" />
              <span class="font-medium">前提条件</span>
            </label>
          </li>

          <li>
            <label class="flex items-center gap-2">
              <el-checkbox v-model="opts.includeDeliverables" />
              <span class="font-medium">交付物清单</span>
            </label>
          </li>

          <li>
            <label class="flex items-center gap-2">
              <el-checkbox v-model="opts.includeFunctions" />
              <span class="font-medium">功能清单</span>
            </label>
          </li>
        </ul>
      </div>
    </div>

    <!-- 生成弹窗（保留原 QuoteAiDraftDialog 作 Excel 生成骨架） -->
    <QuoteAiDraftDialog
      ref="dialogRef"
      :open="dialogOpen"
      :project-id="projectId"
      :templates="templates"
      @close="dialogOpen = false"
      @generate="onGenerate"
      @upload="onUpload"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import SummaryCell from "@frontend/features/business-module/components/SummaryCell.vue";
import QuoteAiDraftDialog from "./QuoteAiDraftDialog.vue";
import { useQuoteStore } from "../stores/quote.store.ts";
import { useHardwareItemsStore } from "@frontend/features/business-module/stores/hardware-items.store.ts";

const props = defineProps<{ projectId: string }>();
const quoteStore = useQuoteStore();
const hwStore = useHardwareItemsStore();
const dialogRef = ref<InstanceType<typeof QuoteAiDraftDialog> | null>(null);

const dialogOpen = ref(false);

const snapshot = computed(() => quoteStore.getSnapshot(props.projectId));
const templates = computed(() => quoteStore.getTemplates(props.projectId));
const error = computed(() => quoteStore.error);
const hardwareItems = computed(() => hwStore.getItems(props.projectId));

interface QuoteGenerationOptions {
  includeFunctionCost: boolean;
  functionCostGrouping: "byModule" | "byStage";
  bufferAllocated: boolean;
  includeHardware: boolean;
  includePrecondition: boolean;
  includeDeliverables: boolean;
  includeFunctions: boolean;
}
const opts = ref<QuoteGenerationOptions>({
  includeFunctionCost: true,
  functionCostGrouping: "byModule",
  bufferAllocated: false,
  includeHardware: true,
  // 阶段 B6：报价单 checkbox 默认全选（用户要求）
  includePrecondition: true,
  includeDeliverables: true,
  includeFunctions: true,
});

const hardwareTotal = computed(() =>
  hardwareItems.value.reduce((sum, hw) => sum + (hw.item?.subtotal ?? 0), 0),
);

const hasAnySelection = computed(() =>
  opts.value.includeFunctionCost ||
  opts.value.includeHardware ||
  opts.value.includePrecondition ||
  opts.value.includeDeliverables ||
  opts.value.includeFunctions,
);

onMounted(async () => {
  await Promise.all([
    quoteStore.loadSnapshot(props.projectId),
    quoteStore.loadTemplates(props.projectId),
    hwStore.load(props.projectId),
  ]);
});

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
  // 记录本次勾选的输出项（用于追溯 / 后端未来支持时透传）
  console.info("[quote] 生成 Excel 勾选项:", opts.value);
}

async function onUpload(file: File) {
  await quoteStore.uploadTemplate(props.projectId, file);
}
</script>