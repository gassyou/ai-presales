<!--
  CustomPageEditor.vue
  =====================
  单个自定义页面编辑器（阶段 7.4d）。

  与 MarkdownModuleView 的差异：
    - props 是 itemId + title（不是 projectId + kind）
    - 没有 status badge / 采用切换（自定义页面始终 pending）
    - 操作：AI 生成 / 下载 / 删除

 形态（复用 markdown 视图的 Tailwind 类 + 800ms debounce）：
    - 顶部：标题 + 状态 + AI 生成 / 下载 / 删除
    - 主体：编辑（textarea）/ 预览切换
-->
<template>
  <div class="rounded border border-border bg-white/40 p-3">
    <header class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h4 class="flex items-center gap-2 text-sm font-medium text-slate-800">
        {{ title }}
        <span
          v-if="item"
          class="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-600"
        >{{ statusLabel(item.status) }}</span>
      </h4>
      <div class="flex flex-wrap gap-2">
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="edit">编辑</el-radio-button>
          <el-radio-button value="preview">预览</el-radio-button>
        </el-radio-group>
        <el-button
          size="small"
          :disabled="generating"
          @click="onGenerate"
        >{{ generating ? "生成中…" : "AI 生成" }}</el-button>
        <el-button
          v-if="item && item.content"
          size="small"
          @click="onDownload"
        >下载</el-button>
        <el-button size="small" type="danger" plain @click="onDelete">删除</el-button>
      </div>
    </header>

    <p v-if="error" class="mb-2 text-xs text-red-300">{{ error }}</p>

    <el-input
      v-if="mode === 'edit'"
      v-model="draft"
      type="textarea"
      :rows="10"
      class="!font-mono"
      :placeholder="`编辑 ${title} 的内容…`"
      @input="onDraftChange"
    />
    <div
      v-else
      class="min-h-[160px] whitespace-pre-wrap rounded border border-border bg-white/50 p-3 text-xs text-slate-800"
    >{{ draft || "（暂无内容）" }}</div>

    <p v-if="saving" class="mt-1 text-[10px] text-slate-500">保存中…</p>
    <p v-else-if="lastSavedAt" class="mt-1 text-[10px] text-emerald-400">
      已保存 {{ formatRelative(lastSavedAt) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { businessModuleApi } from "../api/business-module.api.ts";
import type { BusinessModuleItemDTO } from "@shared/types/dto/business-module.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const props = defineProps<{
  projectId: string;
  itemId: string;
  title: string;
}>();

const emit = defineEmits<{
  (e: "deleted", itemId: string): void;
  (e: "updated", item: BusinessModuleItemDTO): void;
}>();

const item = ref<BusinessModuleItemDTO | null>(null);
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

async function load(): Promise<void> {
  error.value = null;
  try {
    const r = await businessModuleApi.get(props.itemId);
    item.value = r;
    draft.value = r.content;
  } catch (e) {
    error.value = errMsg(e);
  }
}

function onDraftChange(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saving.value = true;
    try {
      const updated = await businessModuleApi.update(props.itemId, { content: draft.value });
      item.value = updated;
      lastSavedAt.value = new Date();
      emit("updated", updated);
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      saving.value = false;
    }
  }, 800) as unknown as number;
}

async function onGenerate(): Promise<void> {
  generating.value = true;
  try {
    const updated = await businessModuleApi.generate(props.itemId);
    item.value = updated;
    draft.value = updated.content;
    lastSavedAt.value = new Date();
    emit("updated", updated);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    generating.value = false;
  }
}

function onDownload(): void {
  if (!item.value) return;
  const safeName = props.title.replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob([draft.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function onDelete(): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${props.title}」？此操作不可撤销。`, "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await businessModuleApi.delete(props.itemId);
    emit("deleted", props.itemId);
  } catch (e) {
    error.value = errMsg(e);
  }
}

function errMsg(e: unknown): string {
  return e instanceof ApiError
    ? `${e.envelope.code}: ${e.envelope.message}`
    : e instanceof Error
    ? e.message
    : String(e);
}

watch(() => props.itemId, () => {
  void load();
});

onMounted(() => {
  void load();
});
</script>