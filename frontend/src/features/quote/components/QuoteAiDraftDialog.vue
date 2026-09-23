<!--
  QuoteAiDraftDialog.vue
  =======================
  报价单 AI 生成弹窗（阶段 7.4f）。
  - 用户输入补充说明（客户关注点 / 优惠 / 备注）
  - 生成：先调 draft（proposal-drafter sub-agent 起草 markdown），再触发 generate（生成 .xlsx）
  - 完成后给下载按钮
  阶段 7.5（M9）：去掉占位 setTimeout(800)；真调 LLM
-->
<template>
  <div
    v-if="open"
    class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40"
    @click.self="$emit('close')"
  >
    <div class="w-[520px] rounded-lg border border-border bg-white p-5 shadow-xl">
      <h3 class="mb-3 text-sm font-semibold text-slate-900">生成报价单</h3>

      <label class="mb-2 block text-xs text-slate-700">
        <span>补充说明（可选）</span>
        <textarea
          v-model="userInput"
          rows="4"
          class="mt-1 w-full rounded border border-border bg-surface-alt px-2 py-1 text-sm text-slate-900"
          placeholder="例如：客户关注点 / 优惠幅度 / 备注信息"
        />
      </label>

      <div class="mb-3">
        <QuoteTemplatePicker
          :templates="templates"
          :model-value="templateId"
          @update:model-value="templateId = $event"
          @upload="onUpload"
        />
        <p v-if="uploadError" class="mt-1 text-xs text-rose-700">{{ uploadError }}</p>
      </div>

      <div v-if="error" class="mb-3 rounded border border-rose-700 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        {{ error }}
      </div>

      <div v-if="lastResult" class="mb-3 rounded border border-emerald-700 bg-accent-soft px-3 py-2 text-xs text-emerald-700">
        已生成：{{ lastResult.filename }}
        <a
          :href="downloadHref"
          class="ml-2 rounded bg-emerald-700 px-2 py-0.5 text-emerald-100 hover:bg-emerald-600"
          download
        >下载</a>
      </div>

      <div class="flex justify-end gap-2 text-xs">
        <button
          class="rounded bg-surface-sunken px-3 py-1 text-slate-800 hover:bg-slate-600"
          @click="$emit('close')"
        >关闭</button>
        <button
          class="rounded bg-sky-700 px-3 py-1 text-sky-100 hover:bg-sky-600 disabled:opacity-50"
          :disabled="busy"
          @click="onGenerate"
        >{{ busy ? "生成中…" : "生成并下载" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import QuoteTemplatePicker from "./QuoteTemplatePicker.vue";
import { quoteApi, type TemplateDTO } from "../api/quote.api.ts";

const props = defineProps<{
  open: boolean;
  projectId: string;
  templates: TemplateDTO[];
}>();

const emit = defineEmits<{
  close: [];
  generate: [args: { templateId?: string; userInput: string; aiMarkdown?: string }];
  upload: [file: File];
}>();

const userInput = ref("");
const templateId = ref<string | undefined>(undefined);
const busy = ref(false);
const error = ref<string | null>(null);
const uploadError = ref<string | null>(null);
const lastResult = ref<{ runId: string; filename: string; mimeType: string } | null>(null);

const downloadHref = computed(() =>
  lastResult.value ? `/api/projects/${props.projectId}/quote/runs/${lastResult.value.runId}/download` : ""
);

watch(() => props.open, (o) => {
  if (o) {
    userInput.value = "";
    templateId.value = undefined;
    error.value = null;
    uploadError.value = null;
  }
});

async function onGenerate() {
  busy.value = true;
  error.value = null;
  try {
    // 阶段 7.5（M9）：先调 draft（proposal-drafter sub-agent）拿 aiMarkdown，再触发 generate
    let aiMarkdown = "";
    try {
      const d = await quoteApi.draft(props.projectId, { userInput: userInput.value });
      aiMarkdown = d.markdown;
    } catch (e) {
      // draft 失败不阻塞 .xlsx 生成（后端 aiGenerateMarkdown 已 catch 失败返 ""）
      console.warn("quote draft failed (continuing without AI markdown):", e);
    }
    emit("generate", {
      templateId: templateId.value,
      userInput: userInput.value,
      aiMarkdown,
    });
    // parent 会在 onGenerate 里 setResult / setError
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    busy.value = false;
  }
}

async function onUpload(file: File) {
  uploadError.value = null;
  emit("upload", file);
}

defineExpose({
  setResult: (r: { runId: string; filename: string; mimeType: string }) => {
    lastResult.value = r;
    busy.value = false;
  },
  setError: (e: string) => {
    error.value = e;
    busy.value = false;
  },
});
</script>