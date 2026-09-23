<!--
  MarkdownModuleView.vue
  =====================
  通用 markdown 模块编辑器（阶段 7.3）。

  适用 11 个模块（业务现状/痛点/改善/构想/非功能/IT/风险/TO-BE/ROI/前提/硬件成本）。
  通过 props.kind 区分；后端用同一份 /markdown 端点。

  形态：
    - 顶部：标题 + 状态徽章 + AI 生成 / 下载 / 采用切换
    - 主体：编辑（textarea）/ 预览（简单 markdown → HTML 渲染）切换
    - 自动保存：编辑时 800ms debounce 后 PUT
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="flex items-center gap-2 text-sm font-medium text-slate-700">
        {{ title }}
        <span v-if="item" :class="statusClass(item.status)">
          {{ statusLabel(item.status) }}
        </span>
      </h2>
      <div class="flex flex-wrap gap-2">
        <div class="flex rounded border border-border text-xs">
          <button
            :class="mode === 'edit' ? 'bg-accent/20 text-accent' : 'text-slate-600 hover:bg-surface-alt'"
            class="rounded-l px-2 py-1"
            @click="mode = 'edit'"
          >编辑</button>
          <button
            :class="mode === 'preview' ? 'bg-accent/20 text-accent' : 'text-slate-600 hover:bg-surface-alt'"
            class="rounded-r px-2 py-1"
            @click="mode = 'preview'"
          >预览</button>
        </div>
        <button
          class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
          :disabled="generating"
          @click="onGenerate"
        >
          {{ generating ? "生成中…" : "AI 生成" }}
        </button>
        <button
          v-if="item && item.content"
          class="rounded border border-border px-2 py-1 text-xs text-slate-700 hover:bg-surface-alt"
          @click="onDownload"
        >下载</button>
        <button
          v-if="item && item.status !== 'adopted'"
          class="rounded border border-accent px-2 py-1 text-xs text-emerald-700 hover:bg-accent-soft"
          @click="onAdopt(true)"
        >采用</button>
        <button
          v-if="item && item.status === 'adopted'"
          class="rounded border border-border px-2 py-1 text-xs text-slate-600 hover:bg-surface-alt"
          @click="onAdopt(false)"
        >不采用</button>
      </div>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

    <textarea
      v-if="mode === 'edit'"
      v-model="draft"
      rows="14"
      class="w-full rounded border border-border bg-white p-2 font-mono text-xs text-slate-800"
      :placeholder="`编辑 ${title}…`"
      @input="onDraftChange"
    />
    <div
      v-else
      class="min-h-[200px] whitespace-pre-wrap rounded border border-border bg-white/50 p-3 text-xs text-slate-800"
    >{{ draft || "（暂无内容）" }}</div>

    <p v-if="saving" class="text-[10px] text-slate-500">保存中…</p>
    <p v-else-if="lastSavedAt" class="text-[10px] text-emerald-400">
      已保存 {{ formatRelative(lastSavedAt) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { markdownModuleApi, type MarkdownModuleResult } from "../api/markdown-module.api.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const props = defineProps<{
  projectId: string;
  kind: BusinessModuleKind;
  title: string;
}>();

const item = ref<MarkdownModuleResult | null>(null);
const draft = ref<string>("");
const mode = ref<"edit" | "preview">("edit");
const error = ref<string | null>(null);
const saving = ref(false);
const lastSavedAt = ref<Date | null>(null);
const generating = ref(false);

let saveTimer: number | null = null;

function formatRelative(d: Date): string {
  const delta = Date.now() - d.getTime();
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function statusLabel(s: "pending" | "adopted" | "unadopted"): string {
  if (s === "adopted") return "已采用";
  if (s === "unadopted") return "不采用";
  return "待定";
}

function statusClass(s: "pending" | "adopted" | "unadopted"): string {
  if (s === "adopted") return "rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent";
  if (s === "unadopted") return "rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-500";
  return "rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-600";
}

async function load(): Promise<void> {
  error.value = null;
  try {
    const r = await markdownModuleApi.get(props.projectId, props.kind);
    if (r.item) {
      item.value = r.item;
    } else {
      // 首次进入自动 getOrInit（拿模板）
      item.value = await markdownModuleApi.getOrInit(props.projectId, props.kind);
    }
    if (item.value) draft.value = item.value.content;
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

function onDraftChange(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!item.value) return;
    saving.value = true;
    try {
      const updated = await markdownModuleApi.save(props.projectId, props.kind, draft.value);
      item.value = updated;
      lastSavedAt.value = new Date();
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    } finally {
      saving.value = false;
    }
  }, 800) as unknown as number;
}

async function onGenerate(): Promise<void> {
  generating.value = true;
  try {
    const updated = await markdownModuleApi.generate(props.projectId, props.kind);
    item.value = updated;
    draft.value = updated.content;
    lastSavedAt.value = new Date();
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  } finally {
    generating.value = false;
  }
}

async function onAdopt(adopt: boolean): Promise<void> {
  try {
    const updated = adopt
      ? await markdownModuleApi.adopt(props.projectId, props.kind)
      : await markdownModuleApi.unadopt(props.projectId, props.kind);
    item.value = updated;
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

function onDownload(): void {
  if (!item.value) return;
  const blob = new Blob([draft.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.title}-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

watch(() => [props.projectId, props.kind], () => {
  void load();
});

onMounted(() => {
  void load();
});
</script>
