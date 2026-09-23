<!--
  PptAiGenerateDialog.vue
  ======================
  AI 生成 PPT 弹窗（阶段 7.4c）。

  工作流：
    - 用户填需求（textarea）+ 可选选择 profile
    - 点「开始生成」→ store.generateStream 流式消费 → ppt_page 事件实时落库
    - 进度提示：「已生成 X 页 / 总 N 页（基于当前批次）」
    - 「停止」→ abort signal
-->
<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4"
    @click.self="onClose"
  >
    <div class="w-full max-w-lg rounded border border-border bg-white p-4 shadow-xl">
      <h3 class="mb-3 text-sm font-medium text-slate-800">AI 生成 PPT</h3>
      <p class="mb-2 text-xs text-slate-600">
        描述你的提案主题 / 客户 / 受众 / 时长等。AI 会按 8~15 页逐页生成设计提示词。
      </p>
      <textarea
        v-model="userInput"
        rows="5"
        class="w-full rounded border border-border bg-surface-alt p-2 text-xs text-slate-800"
        placeholder="例：为 XX 制造业数字化转型提案设计 10 页 PPT，受众为客户 CIO + IT 负责人"
        :disabled="running"
      />

      <div v-if="running" class="mt-3 flex items-center gap-2 text-xs text-accent">
        <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"></span>
        正在生成… 已新增 {{ lastCount }} 页
      </div>

      <p v-if="error" class="mt-2 text-xs text-red-300">{{ error }}</p>

      <div class="mt-3 flex justify-end gap-2">
        <button
          class="rounded border border-border px-3 py-1 text-xs text-slate-700 hover:bg-surface-alt"
          @click="onClose"
        >关闭</button>
        <button
          v-if="!running"
          class="rounded border border-accent/50 px-3 py-1 text-xs text-accent hover:bg-accent/10"
          :disabled="userInput.trim().length === 0"
          @click="onStart"
        >开始生成</button>
        <button
          v-else
          class="rounded border border-red-700/50 px-3 py-1 text-xs text-red-300 hover:bg-red-900/30"
          @click="onAbort"
        >停止</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { usePptStore } from "../stores/ppt.store.ts";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = usePptStore();
const userInput = ref("");
const running = ref(false);
const lastCount = ref(0);
const abortCtrl = ref<AbortController | null>(null);

const error = computed(() => store.error);

async function onStart(): Promise<void> {
  if (userInput.value.trim().length === 0) return;
  if (running.value) return; // 防止双击
  running.value = true;
  lastCount.value = 0;
  const before = store.getList(props.projectId).length;
  abortCtrl.value = new AbortController();
  try {
    await store.generateStream(props.projectId, userInput.value, {
      signal: abortCtrl.value.signal,
    });
    const after = store.getList(props.projectId).length;
    lastCount.value = Math.max(0, after - before);
  } finally {
    // 流结束（正常/abort/error）都清状态；store.generateStream 已经把 generating 清干净
    running.value = false;
    abortCtrl.value = null;
  }
}

function onAbort(): void {
  abortCtrl.value?.abort();
  // 不立即设 running=false —— 流真正结束（带 ABORTED 事件）后才清
  // store.generateStream 的 finally 会负责
}

function onClose(): void {
  if (running.value) abortCtrl.value?.abort();
  emit("close");
}
</script>