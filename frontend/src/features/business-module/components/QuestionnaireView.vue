<!--
  QuestionnaireView.vue
  =====================
  「调查问卷」主组件（阶段 7.2）。

  两种展现方式（需求文档第 5 条）：
    1. 便签贴式 —— 按 outlinePath 分组的卡片，每张卡片显示问题标题
    2. 回答模式 —— 双栏：左列问题列表（含增/删/复制）；右列：问题显示区 + 回答输入区

  顶部操作：
    - 编辑脑图大纲（抽屉式）
    - 一键从脑图生成初始问题
    - 下载 Word（markdown 格式）

  数据：
    - 大纲 + 问题 通过 surveyQuestionnaireApi
    - 状态本地管理；保存回答走 PATCH（debounce 500ms）
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">
        调查问卷
        <span v-if="questions.length > 0" class="text-slate-500">
          （{{ questions.length }} 题）
        </span>
      </h2>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded border border-border px-2 py-1 text-xs text-slate-700 hover:bg-surface-alt"
          @click="openOutlineEditor"
        >
          {{ outline ? "编辑脑图" : "创建脑图大纲" }}
        </button>
        <button
          v-if="outline"
          class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
          :disabled="!outline.mindmap"
          @click="onBatchFromMindmap"
        >
          从脑图生成问题
        </button>
        <button
          v-if="questions.length > 0"
          class="rounded border border-border px-2 py-1 text-xs text-slate-700 hover:bg-surface-alt"
          @click="onDownload"
        >
          下载 Word
        </button>
        <div class="flex rounded border border-border text-xs">
          <button
            :class="viewMode === 'sticky' ? 'bg-accent/20 text-accent' : 'text-slate-600 hover:bg-surface-alt'"
            class="rounded-l px-2 py-1"
            @click="viewMode = 'sticky'"
          >
            便签贴式
          </button>
          <button
            :class="viewMode === 'answer' ? 'bg-accent/20 text-accent' : 'text-slate-600 hover:bg-surface-alt'"
            class="rounded-r px-2 py-1"
            @click="viewMode = 'answer'"
          >
            回答模式
          </button>
        </div>
      </div>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>
    <p v-else-if="!outline" class="text-xs text-slate-500">
      暂无大纲。点击右上角"创建脑图大纲"开始。
    </p>

    <!-- 视图：便签贴式 -->
    <div v-if="viewMode === 'sticky'" class="space-y-3">
      <div
        v-for="group in groupedQuestions"
        :key="group.path"
        class="flex flex-col gap-2"
      >
        <h3 class="text-xs font-medium text-slate-600">{{ group.path || "（未分组）" }}</h3>
        <ul class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="q in group.items"
            :key="q.id"
            class="rounded border border-border bg-amber-50 p-3 text-xs text-slate-800"
          >
            <div class="font-medium">{{ q.title }}</div>
            <div v-if="q.answer" class="mt-1 whitespace-pre-wrap text-slate-600">
              答：{{ q.answer }}
            </div>
            <div class="mt-2 flex justify-end">
              <button
                class="rounded px-1 text-slate-500 hover:text-red-400"
                @click="onDeleteQuestion(q.id)"
              >
                删除
              </button>
            </div>
          </li>
        </ul>
      </div>
      <p v-if="questions.length === 0" class="text-xs text-slate-500">
        还没有问题。点击"从脑图生成问题"批量生成占位问题，或手动添加。
      </p>
      <button
        v-if="outline"
        class="self-start rounded border border-border px-2 py-1 text-xs text-slate-700 hover:bg-surface-alt"
        @click="onAddManualQuestion"
      >
        + 手动添加问题
      </button>
    </div>

    <!-- 视图：回答模式（双栏） -->
    <div v-else-if="viewMode === 'answer'" class="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <!-- 左：列表 -->
      <aside class="flex flex-col gap-1">
        <div class="flex items-center justify-between text-xs text-slate-600">
          <span>问题列表（{{ questions.length }}）</span>
          <div class="flex gap-1">
            <button
              v-if="outline"
              class="rounded px-1 hover:text-slate-800"
              title="添加"
              @click="onAddManualQuestion"
            >＋</button>
          </div>
        </div>
        <ul class="max-h-[480px] overflow-auto rounded border border-border">
          <li
            v-for="(q, i) in questions"
            :key="q.id"
            :class="[
              'cursor-pointer border-b border-border px-3 py-2 text-xs',
              selectedId === q.id ? 'bg-accent/20 text-slate-900' : 'text-slate-700 hover:bg-surface-alt/60',
            ]"
            @click="selectedId = q.id"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="line-clamp-2 flex-1">{{ i + 1 }}. {{ q.title }}</span>
              <div class="flex shrink-0 gap-1">
                <button
                  class="rounded px-1 text-slate-500 hover:text-slate-700"
                  title="复制"
                  @click.stop="onCopyQuestion(q.id)"
                >⎘</button>
                <button
                  class="rounded px-1 text-slate-500 hover:text-red-400"
                  title="删除"
                  @click.stop="onDeleteQuestion(q.id)"
                >✕</button>
              </div>
            </div>
          </li>
          <li v-if="questions.length === 0" class="px-3 py-2 text-xs text-slate-500">空</li>
        </ul>
      </aside>

      <!-- 右：详情 -->
      <main class="flex flex-col gap-3 rounded border border-border p-3">
        <div v-if="selected" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1 text-xs">
            <label class="text-slate-500">问题显示区</label>
            <textarea
              v-model="selected.title"
              rows="3"
              class="rounded border border-border bg-white px-2 py-1 text-slate-800"
              @change="onUpdateTitle(selected)"
            />
          </div>
          <div class="flex flex-col gap-1 text-xs">
            <label class="text-slate-500">回答输入区</label>
            <textarea
              v-model="answerDraft"
              rows="6"
              class="rounded border border-border bg-white px-2 py-1 text-slate-800"
              placeholder="光标默认在此输入回答…"
              @input="onAnswerDraftChange"
            />
            <p v-if="savingAnswer" class="text-[10px] text-slate-500">保存中…</p>
            <p v-else-if="lastSavedAnswerAt" class="text-[10px] text-emerald-400">
              已保存 {{ formatRelative(lastSavedAnswerAt) }}
            </p>
          </div>
          <div class="text-[10px] text-slate-500">
            大纲路径：{{ selected.outlinePath || "（未关联）" }}
          </div>
        </div>
        <p v-else class="text-xs text-slate-500">左侧选中一个问题查看详情。</p>
      </main>
    </div>

    <!-- 大纲编辑器抽屉 -->
    <div
      v-if="showOutlineEditor"
      class="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      @click.self="closeOutlineEditor"
    >
      <div class="flex h-full w-full max-w-xl flex-col gap-3 overflow-auto bg-canvas p-4">
        <header class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-slate-800">编辑脑图大纲</h3>
          <button class="text-slate-500 hover:text-slate-700" @click="closeOutlineEditor">✕</button>
        </header>
        <p class="text-xs text-slate-500">
          双击节点改名 · 右键节点弹出菜单（＋子 / ⎁兄弟 / ←→ 调层级 / ✕删除 / 复制粘贴）·
          拖拽节点调整层级 · 右上角撤销重做 / 缩放 / 居中
        </p>
        <MindmapEditor
          v-if="outlineDraft"
          :nodes="outlineDraft.children"
          @update:nodes="onOutlineNodesChange"
        />
        <div v-else>
          <button
            class="rounded border border-accent/50 px-2 py-1 text-xs text-accent hover:bg-accent/10"
            @click="initOutlineDraft"
          >
            + 创建根节点
          </button>
        </div>
        <div class="flex justify-end gap-2 border-t border-border pt-3">
          <button
            class="rounded border border-border px-3 py-1 text-xs text-slate-600 hover:bg-surface-alt"
            @click="closeOutlineEditor"
          >
            取消
          </button>
          <button
            class="rounded border border-accent/50 bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20"
            @click="saveOutlineDraft"
          >
            保存大纲
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  surveyQuestionnaireApi,
  type MindmapNode,
  type QuestionDTO,
} from "../api/survey-questionnaire.api.ts";
import MindmapEditor from "./MindmapEditor.vue";
import { ApiError } from "@frontend/shared/api/http-client.ts";

const props = defineProps<{ projectId: string }>();

const outline = ref<{ id: string; mindmap: MindmapNode | null } | null>(null);
const questions = ref<QuestionDTO[]>([]);
const error = ref<string | null>(null);
const viewMode = ref<"sticky" | "answer">("sticky");
const showOutlineEditor = ref(false);
const outlineDraft = ref<MindmapNode | null>(null);

// 回答模式
const selectedId = ref<string | null>(null);
const selected = computed(() => questions.value.find((q) => q.id === selectedId.value) ?? null);
const answerDraft = ref<string>("");
const savingAnswer = ref(false);
const lastSavedAnswerAt = ref<Date | null>(null);
let answerTimer: number | null = null;

const groupedQuestions = computed(() => {
  const groups = new Map<string, QuestionDTO[]>();
  for (const q of questions.value) {
    const key = q.outlinePath ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }
  return [...groups.entries()].map(([path, items]) => ({
    path: path === "" ? "（未分组）" : path,
    items,
  }));
});

function formatRelative(d: Date): string {
  const delta = Date.now() - d.getTime();
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

async function loadAll(): Promise<void> {
  error.value = null;
  try {
    const o = await surveyQuestionnaireApi.getOutline(props.projectId);
    outline.value = o.outline ? { id: o.outline.id, mindmap: o.outline.mindmap } : null;
    if (outline.value) {
      const q = await surveyQuestionnaireApi.listQuestions(props.projectId);
      questions.value = q.questions;
      if (!selectedId.value && questions.value.length > 0) {
        selectedId.value = questions.value[0]!.id;
        answerDraft.value = questions.value[0]!.answer ?? "";
      }
    } else {
      questions.value = [];
    }
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

function openOutlineEditor(): void {
  outlineDraft.value = outline.value?.mindmap
    ? JSON.parse(JSON.stringify(outline.value.mindmap)) as MindmapNode
    : null;
  showOutlineEditor.value = true;
}

function closeOutlineEditor(): void {
  showOutlineEditor.value = false;
}

function initOutlineDraft(): void {
  outlineDraft.value = {
    id: crypto.randomUUID(),
    text: "调查主题",
    children: [],
  };
}

function onOutlineNodesChange(nodes: MindmapNode[]): void {
  // MindmapEditor emits the new top-level children list; copy into outlineDraft
  if (outlineDraft.value) {
    outlineDraft.value.children = nodes;
  }
}

async function saveOutlineDraft(): Promise<void> {
  if (!outlineDraft.value) {
    showOutlineEditor.value = false;
    return;
  }
  try {
    const saved = await surveyQuestionnaireApi.saveOutline(props.projectId, outlineDraft.value);
    outline.value = { id: saved.id, mindmap: saved.mindmap };
    showOutlineEditor.value = false;
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

async function onBatchFromMindmap(): Promise<void> {
  try {
    const r = await surveyQuestionnaireApi.batchFromMindmap(props.projectId);
    questions.value = r.questions;
    if (!selectedId.value && questions.value.length > 0) {
      selectedId.value = questions.value[0]!.id;
    }
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

async function onAddManualQuestion(): Promise<void> {
  if (!outline.value) return;
  const nextOrdinal = questions.value.length;
  const path = outline.value.mindmap?.text ?? "（手动）";
  try {
    const q = await surveyQuestionnaireApi.createQuestion(props.projectId, {
      parentId: outline.value.id,
      ordinal: nextOrdinal,
      title: "新问题",
      outlinePath: path,
    });
    questions.value = [...questions.value, q];
    selectedId.value = q.id;
    viewMode.value = "answer";
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

async function onDeleteQuestion(qid: string): Promise<void> {
  if (!confirm("确认删除？")) return;
  try {
    await surveyQuestionnaireApi.deleteQuestion(props.projectId, qid);
    questions.value = questions.value.filter((q) => q.id !== qid);
    if (selectedId.value === qid) {
      selectedId.value = questions.value[0]?.id ?? null;
    }
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

async function onCopyQuestion(qid: string): Promise<void> {
  const q = questions.value.find((x) => x.id === qid);
  if (!q || !outline.value) return;
  const nextOrdinal = questions.value.length;
  try {
    const c = await surveyQuestionnaireApi.createQuestion(props.projectId, {
      parentId: outline.value.id,
      ordinal: nextOrdinal,
      title: `${q.title}（副本）`,
      outlinePath: q.outlinePath,
    });
    questions.value = [...questions.value, c];
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

async function onUpdateTitle(q: QuestionDTO): Promise<void> {
  try {
    await surveyQuestionnaireApi.updateQuestion(props.projectId, q.id, { title: q.title });
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

function onAnswerDraftChange(): void {
  if (answerTimer !== null) clearTimeout(answerTimer);
  answerTimer = setTimeout(async () => {
    if (!selected.value) return;
    savingAnswer.value = true;
    try {
      await surveyQuestionnaireApi.saveAnswer(
        props.projectId,
        selected.value.id,
        answerDraft.value,
      );
      const idx = questions.value.findIndex((q) => q.id === selected.value!.id);
      if (idx >= 0) {
        questions.value[idx] = { ...questions.value[idx]!, answer: answerDraft.value };
      }
      lastSavedAnswerAt.value = new Date();
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    } finally {
      savingAnswer.value = false;
    }
  }, 500) as unknown as number;
}

watch(selected, (s) => {
  answerDraft.value = s?.answer ?? "";
});

watch(() => props.projectId, () => {
  selectedId.value = null;
  answerDraft.value = "";
  void loadAll();
});

function onDownload(): void {
  // 导出 markdown（Word 可直接打开 .md；阶段 7.x 可接 docx 库）
  const lines: string[] = [];
  lines.push("# 调查问卷\n");
  for (const g of groupedQuestions.value) {
    lines.push(`## ${g.path}\n`);
    for (const q of g.items) {
      lines.push(`### ${q.title}\n`);
      lines.push(q.answer ? `\n${q.answer}\n` : "\n（未回答）\n");
      lines.push("");
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `questionnaire-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(() => {
  void loadAll();
});
</script>
