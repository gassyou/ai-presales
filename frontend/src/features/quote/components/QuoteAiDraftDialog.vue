<!--
  QuoteAiDraftDialog.vue
  =======================
  报价单 AI 生成弹窗（阶段 7.4f + Element Plus 迁移）。
-->
<template>
  <el-dialog
    :model-value="open"
    title="生成报价单"
    width="540"
    @update:model-value="(v) => !v && emit('close')"
  >
    <div class="flex flex-col gap-3">
      <el-form-item label="补充说明（可选）" class="!mb-0">
        <el-input
          v-model="userInput"
          type="textarea"
          :rows="4"
          placeholder="例如：客户关注点 / 优惠幅度 / 备注信息"
        />
      </el-form-item>

      <div>
        <QuoteTemplatePicker
          :templates="templates"
          :model-value="templateId"
          @update:model-value="templateId = $event"
          @upload="onUpload"
        />
        <p v-if="uploadError" class="mt-1 text-xs text-rose-700">{{ uploadError }}</p>
      </div>

      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
      />

      <el-alert
        v-if="lastResult"
        :title="`已生成：${lastResult.filename}`"
        type="success"
        :closable="false"
        show-icon
      >
        <template #default>
          <div class="flex items-center justify-between">
            <span>已生成：{{ lastResult.filename }}</span>
            <el-link
              :href="downloadHref"
              type="primary"
              :underline="false"
              download
            >下载</el-link>
          </div>
        </template>
      </el-alert>
    </div>

    <template #footer>
      <el-button @click="emit('close')">关闭</el-button>
      <el-button
        type="primary"
        :loading="busy"
        @click="onGenerate"
      >
        {{ busy ? "生成中…" : "生成并下载" }}
      </el-button>
    </template>
  </el-dialog>
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