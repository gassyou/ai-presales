<!--
  QuestionnaireView.vue
  =====================
  「调查问卷」主组件（阶段 7.2 + 重构）。

  三种展现方式（需求文档第 5 条）：
    1. 便签贴式 —— 按 outlinePath 分组的卡片，每张卡片显示问题标题
    2. 回答模式 —— 双栏：左列问题列表（含增/删/复制）；右列：问题显示区 + 回答输入区
    3. 脑图模式 —— **脑图直接在主区编辑**（不再是抽屉）。vue3-mindmap 的
       双击/右键/拖拽即可增删改节点；800ms debounce 后 PUT 到后端。

  数据：
    - 大纲 + 问题 通过 surveyQuestionnaireApi
    - 状态本地管理；保存回答走 PATCH（debounce 500ms）
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">
        调查问卷
        <span v-if="questions.length > 0" class="text-slate-500">
          （{{ questions.length }} 题）
        </span>
      </h2>
      <div class="flex flex-wrap gap-2">
        <!-- 阶段 B25：移除「从脑图生成问题」按钮（用户要求；保留 surveyQuestionnaireApi.batchFromMindmap + 后端路由供 auto-mode sub-agent 调用） -->
        <el-button v-if="questions.length > 0 && viewMode !== 'mindmap'" size="small" @click="onDownload">
          下载 Word
        </el-button>
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="sticky">便签贴式</el-radio-button>
          <el-radio-button value="answer">回答模式</el-radio-button>
          <el-radio-button value="mindmap">脑图</el-radio-button>
        </el-radio-group>
      </div>
    </header>

    <p v-if="error" class="text-xs text-red-300">{{ error }}</p>

    <!-- 视图：脑图（直接在主区编辑；首次进入若无大纲则一键创建根节点） -->
    <div v-if="viewMode === 'mindmap'" class="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <div class="flex-1 overflow-hidden rounded border border-border bg-white/30">
        <MindmapEditor v-if="outlineDraft" :nodes="outlineDraft.children" @update:nodes="onOutlineNodesChange" />
      </div>
    </div>

    <!-- 视图：便签贴式 -->
    <div v-else-if="viewMode === 'sticky'" class="flex-1 min-h-0 overflow-auto">
      <el-button class="self-start" size="small" @click="onAddManualQuestion">
        + 手动添加问题
      </el-button>
      <div v-for="group in groupedQuestions" :key="group.path" class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-slate-600">{{ group.path || "（未分组）" }}</h3>
        <ul class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <li v-for="q in group.items" :key="q.id"
            class="rounded border border-border bg-amber-50 p-3 text-xs text-slate-800">
            <div class="font-medium">{{ q.title }}</div>
            <div v-if="q.answer" class="mt-1 whitespace-pre-wrap text-slate-600">
              答：{{ q.answer }}
            </div>
            <div class="mt-2 flex justify-end">
              <el-button link type="danger" size="small" @click="onDeleteQuestion(q.id)">删除</el-button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- 视图：回答模式（双栏） -->
    <div v-else-if="viewMode === 'answer'"
      class="grid flex-1 min-h-0 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <!-- 左：列表 -->
      <aside class="flex flex-col gap-1">
        <div class="flex items-center justify-between text-xs text-slate-600">
          <span>问题列表（{{ questions.length }}）</span>
          <div class="flex gap-1">
            <el-button v-if="outline" link size="small" title="添加" @click="onAddManualQuestion"><el-icon>
                <Plus />
              </el-icon></el-button>
          </div>
        </div>
        <ul class="max-h-[480px] overflow-auto rounded border border-border">
          <li v-for="(q, i) in questions" :key="q.id" :class="[
            'cursor-pointer border-b border-border px-3 py-2 text-xs',
            selectedId === q.id ? 'bg-accent/20 text-slate-900' : 'text-slate-700 hover:bg-surface-alt/60',
          ]" @click="selectedId = q.id">
            <div class="flex items-start justify-between gap-2">
              <span class="line-clamp-2 flex-1">{{ i + 1 }}. {{ q.title }}</span>
              <div class="flex shrink-0 gap-1">
                <el-button link size="small" title="复制" @click.stop="onCopyQuestion(q.id)">⎘</el-button>
                <el-button link type="danger" size="small" title="删除" @click.stop="onDeleteQuestion(q.id)"><el-icon>
                    <Close />
                  </el-icon></el-button>
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
            <el-input v-model="selected.title" type="textarea" :rows="3" @change="onUpdateTitle(selected)" />
          </div>
          <div class="flex flex-col gap-1 text-xs">
            <label class="text-slate-500">回答输入区</label>
            <el-input v-model="answerDraft" type="textarea" :rows="6" placeholder="光标默认在此输入回答…"
              @input="onAnswerDraftChange" />
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Close, Plus } from "@element-plus/icons-vue";
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
const viewMode = ref<"sticky" | "answer" | "mindmap">("sticky");

/** 脑图草稿（vue3-mindmap 在主区直接编辑的对象）。debounce 后 PUT 到后端 */
const outlineDraft = ref<MindmapNode | null>(null);
const savingOutline = ref(false);
const lastSavedOutlineAt = ref<Date | null>(null);
let outlineTimer: number | null = null;

const outlineSaveStatus = computed<string>(() => {
  if (savingOutline.value) return "保存中…";
  if (lastSavedOutlineAt.value) return `已保存 ${formatRelative(lastSavedOutlineAt.value)}`;
  return "";
});

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
    // 进入脑图模式时初始化草稿
    outlineDraft.value = outline.value?.mindmap
      ? JSON.parse(JSON.stringify(outline.value.mindmap)) as MindmapNode
      : null;
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

function initOutlineDraft(): void {
  outlineDraft.value = {
    id: crypto.randomUUID(),
    text: "调查主题",
    children: [],
  };
  scheduleOutlineSave();
}

function onOutlineNodesChange(_nodes: MindmapNode[]): void {
  // MindmapEditor 已 emit 出新的 children 列表，sync 进 outlineDraft
  // （父组件不做额外转换；MindmapEditor 内部已与后端 schema 对齐）
  scheduleOutlineSave();
}

function scheduleOutlineSave(): void {
  if (outlineTimer !== null) clearTimeout(outlineTimer);
  outlineTimer = setTimeout(async () => {
    const draft = outlineDraft.value;
    if (!draft) return;
    savingOutline.value = true;
    try {
      const saved = await surveyQuestionnaireApi.saveOutline(props.projectId, draft);
      outline.value = { id: saved.id, mindmap: saved.mindmap };
      // 用服务端返回值回填，避免与 vue3-mindmap 内部格式偏离
      outlineDraft.value = JSON.parse(JSON.stringify(saved.mindmap)) as MindmapNode;
      lastSavedOutlineAt.value = new Date();
    } catch (e) {
      error.value = e instanceof ApiError
        ? `${e.envelope.code}: ${e.envelope.message}`
        : (e instanceof Error ? e.message : String(e));
    } finally {
      savingOutline.value = false;
    }
  }, 800) as unknown as number;
}

async function onBatchFromMindmap(): Promise<void> {
  // 阶段 B25：UI 入口已移除；保留函数 + 后端路由以便 auto-mode sub-agent 触发
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
  } catch (e) {
    error.value = e instanceof ApiError
      ? `${e.envelope.code}: ${e.envelope.message}`
      : (e instanceof Error ? e.message : String(e));
  }
}

async function onDeleteQuestion(qid: string): Promise<void> {
  try {
    await ElMessageBox.confirm("确认删除？", "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
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
  if (outlineTimer !== null) clearTimeout(outlineTimer);
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