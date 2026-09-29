<!--
  ToolCallCard.vue
  ================
  在 AI 对话消息流中展示工具调用 / 工具结果。
-->
<template>
  <div class="rounded-md border border-border bg-white/70 px-3 py-2 font-mono text-xs">
    <div class="mb-1 flex items-center gap-2 text-slate-700">
      <span class="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] uppercase tracking-wide">工具调用</span>
      <span class="font-semibold">{{ call.name }}</span>
      <span
        v-if="awaitingApproval"
        class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
      >等待审批</span>
    </div>
    <details class="ml-1">
      <summary class="cursor-pointer text-slate-500 hover:text-slate-700">参数</summary>
      <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-slate-600">{{ argsText }}</pre>
    </details>

    <!-- 阶段 H+2：审批按钮（仅 awaitingApproval=true 时） -->
    <div
      v-if="awaitingApproval"
      class="mt-2 flex items-center gap-2 border-t border-amber-200 pt-2"
    >
      <span class="text-[11px] text-amber-700">AI 想执行写操作，需要你确认：</span>
      <button
        class="rounded bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-600"
        @click="emit('approve')"
      >✓ 批准</button>
      <button
        class="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-300"
        @click="emit('reject')"
      >✗ 拒绝</button>
    </div>

    <div v-if="result" class="mt-2 border-t border-border pt-2">
      <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">结果</div>
      <pre class="max-h-40 overflow-auto whitespace-pre-wrap text-slate-700">{{ result }}</pre>
      <div v-if="durationMs !== undefined" class="mt-1 text-right text-[10px] text-slate-600">
        {{ durationMs }}ms
      </div>
    </div>
    <div v-else-if="errorText" class="mt-2 border-t border-red-800 pt-2 text-red-300">
      <div class="mb-1 text-[10px] uppercase tracking-wide text-red-400">错误</div>
      {{ errorText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface ToolCallViewModel {
  readonly name: string;
  readonly args: unknown;
  readonly result?: string;
  readonly ok?: boolean;
  readonly error?: string;
  readonly durationMs?: number;
  readonly awaitingApproval?: boolean;
}

const props = defineProps<{ call: ToolCallViewModel }>();
const emit = defineEmits<{
  approve: [];
  reject: [];
}>();

const argsText = computed(() => JSON.stringify(props.call.args ?? {}, null, 2));
const awaitingApproval = computed(() => props.call.awaitingApproval === true);
const result = computed(() => (props.call.ok === false ? undefined : props.call.result));
const errorText = computed(() => (props.call.ok === false ? props.call.error : undefined));
const durationMs = computed(() => props.call.durationMs);
</script>