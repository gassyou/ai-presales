<!--
  SurveyTaskListView.vue
  =====================
  「调查任务」列表页（阶段 7.1）。

  需求文档「2. 调查任务页面」覆盖：
    1. 新建（任务名 + 详细调查内容）+ 主题示例
    2. 列表 + 状态
    3. 删除
    4. 预览调查结果（markdown）
    5. 采纳 / 不采用
    6. 异步执行 + 进度
    7. 终止任务
    8. AI 一键批量生成（基于示例主题）

  行为：
    - 启动后自动轮询直到 taskStatus 变 completed / aborted
    - 调查结果显示为 markdown 预览（折叠）
    - 采纳 = 进 RAG；不采用 = 跳过
-->
<template>
  <section class="card flex flex-col gap-3">
    <header class="flex items-center justify-between">
      <h2 class="text-sm font-medium text-slate-700">
        调查任务（{{ tasks.length }}）
      </h2>
      <div class="flex gap-2">
        <el-button
          size="small"
          @click="showBatchDialog = true"
        >
          一键批量
        </el-button>
        <el-button
          size="small"
          @click="showCreate = true"
        >
          + 新建调查
        </el-button>
      </div>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>

    <ul v-if="tasks.length > 0" class="space-y-2">
      <li
        v-for="t in tasks"
        :key="t.id"
        class="flex flex-col gap-2 rounded border border-border bg-white/40 p-3 text-xs"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-900">{{ t.title }}</span>
              <span :class="taskStatusClass(effectiveStatus(t))">
                {{ taskStatusLabel(effectiveStatus(t)) }}
              </span>
              <span :class="adoptionClass(t.adoptionStatus)">
                {{ adoptionLabel(t.adoptionStatus) }}
              </span>
            </div>
            <div v-if="t.topicHint" class="text-slate-500">
              主题：{{ t.topicHint }}
            </div>
            <div v-if="t.startedAt" class="text-slate-500">
              开始：{{ formatTime(t.startedAt) }}
              <span v-if="t.completedAt"> · 完成：{{ formatTime(t.completedAt) }}</span>
            </div>
          </div>
          <div class="flex shrink-0 flex-col gap-1">
            <el-button
              v-if="effectiveStatus(t) === 'idle'"
              size="small"
              @click="onStart(t.id)"
            >
              执行
            </el-button>
            <el-button
              v-if="effectiveStatus(t) === 'running'"
              size="small"
              @click="onStop(t.id)"
            >
              终止
            </el-button>
            <el-button
              v-if="effectiveStatus(t) === 'completed' && t.resultContent"
              size="small"
              @click="togglePreview(t.id)"
            >
              {{ previewOpen === t.id ? "收起" : "预览" }}
            </el-button>
            <el-button
              v-if="t.adoptionStatus !== 'adopted'"
              size="small"
              @click="onAdopt(t.id)"
            >
              采用
            </el-button>
            <el-button
              v-if="t.adoptionStatus !== 'unadopted'"
              size="small"
              @click="onUnadopt(t.id)"
            >
              不采用
            </el-button>
            <el-button
              size="small"
              @click="onDelete(t.id)"
            >
              删除
            </el-button>
          </div>
        </div>
        <pre
          v-if="previewOpen === t.id && t.resultContent"
          class="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-canvas/60 p-2 font-mono text-[11px] text-slate-800"
        >{{ t.resultContent }}</pre>
      </li>
    </ul>

    <p v-else class="text-xs text-slate-500">暂无调查任务。点击右上角新建或一键批量。</p>

    <!-- 新建对话框 -->
    <el-dialog
      v-model="showCreate"
      title="新建调查任务"
      width="480px"
      :close-on-click-modal="false"
      @close="showCreate = false"
    >
      <form class="flex flex-col gap-3" @submit.prevent="onCreate">
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          任务名称
          <el-input v-model="form.title" required />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          主题提示
          <el-input
            v-model="form.topicHint"
            placeholder="如：客户背景信息、行业背景"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          详细调查内容
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="4"
            placeholder="需要 AI 调查的要点"
          />
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="showCreate = false">取消</el-button>
          <el-button type="primary" @click="onCreate">创建</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 批量生成对话框 -->
    <el-dialog
      v-model="showBatchDialog"
      title="AI 一键批量生成"
      width="560px"
      :close-on-click-modal="false"
      @close="showBatchDialog = false"
    >
      <div class="flex flex-col gap-3">
        <p class="text-xs text-slate-600">
          基于常见调查主题示例勾选要生成的任务；也可手动增删。
        </p>
        <ul class="max-h-72 space-y-1 overflow-auto rounded border border-border p-2 text-xs text-slate-700">
          <li v-for="(topic, i) in batchTopics" :key="i" class="flex items-center gap-2">
            <el-checkbox v-model="batchSelected[i]" />
            <el-input v-model="batchTopics[i]" class="flex-1" />
            <el-button link type="danger" size="small" @click="removeBatchTopic(i)">×</el-button>
          </li>
        </ul>
        <el-button class="self-start" size="small" @click="addBatchTopic">+ 添加一行</el-button>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="showBatchDialog = false">取消</el-button>
          <el-button type="primary" @click="onBatchGenerate">生成</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useSurveyTaskStore } from "../stores/survey-task.store.ts";
import type { SurveyTaskResult, SurveyTaskStatus } from "../api/survey-task.api.ts";

const props = defineProps<{ projectId: string }>();
const store = useSurveyTaskStore();
const tasks = computed(() => store.getList(props.projectId));
const previewOpen = ref<string | null>(null);

const showCreate = ref(false);
const form = reactive({ title: "", topicHint: "", content: "" });

const showBatchDialog = ref(false);
const batchTopics = ref<string[]>([
  "客户背景信息（人数，年度营业额，组织架构，主营业务）",
  "行业背景信息",
  "专业术语",
  "市场上现有的方案",
  "相关领域相关论文",
  "最新的前沿技术",
]);
const batchSelected = ref<boolean[]>(batchTopics.value.map(() => true));

function effectiveStatus(t: SurveyTaskResult): SurveyTaskStatus {
  return store.getLiveStatus(t.id) ?? t.taskStatus;
}

function taskStatusLabel(s: SurveyTaskStatus): string {
  switch (s) {
    case "idle": return "待执行";
    case "running": return "执行中";
    case "completed": return "已完成";
    case "aborted": return "已终止";
  }
}

function taskStatusClass(s: SurveyTaskStatus): string {
  const base = "rounded px-1.5 py-0.5 text-[10px]";
  switch (s) {
    case "idle": return `${base} bg-surface-alt text-slate-600`;
    case "running": return `${base} bg-amber-50 text-amber-700`;
    case "completed": return `${base} bg-accent-soft text-emerald-700`;
    case "aborted": return `${base} bg-red-900/30 text-red-300`;
  }
}

function adoptionLabel(s: "pending" | "adopted" | "unadopted"): string {
  if (s === "adopted") return "已采用";
  if (s === "unadopted") return "不采用";
  return "待定";
}

function adoptionClass(s: "pending" | "adopted" | "unadopted"): string {
  if (s === "adopted") return "rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent";
  if (s === "unadopted") return "rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-500";
  return "rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-slate-600";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function togglePreview(id: string): void {
  previewOpen.value = previewOpen.value === id ? null : id;
}

async function onCreate(): Promise<void> {
  await store.create(props.projectId, {
    title: form.title,
    topicHint: form.topicHint || undefined,
    content: form.content,
  });
  showCreate.value = false;
  form.title = "";
  form.topicHint = "";
  form.content = "";
}

async function onStart(id: string): Promise<void> {
  await store.start(id, props.projectId);
}

async function onStop(id: string): Promise<void> {
  await store.stop(id, props.projectId);
}

async function onAdopt(id: string): Promise<void> {
  await store.adopt(id, props.projectId);
}

async function onUnadopt(id: string): Promise<void> {
  await store.unadopt(id, props.projectId);
}

async function onDelete(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm("确认删除？相关调查结果也会一并清除。", "提示", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await store.deleteTask(id, props.projectId);
}

function addBatchTopic(): void {
  batchTopics.value.push("");
  batchSelected.value.push(true);
}

function removeBatchTopic(i: number): void {
  batchTopics.value.splice(i, 1);
  batchSelected.value.splice(i, 1);
}

async function onBatchGenerate(): Promise<void> {
  const chosen = batchTopics.value.filter((_, i) => batchSelected.value[i] && _.trim().length > 0);
  if (chosen.length === 0) return;
  await store.batchGenerate(props.projectId, chosen);
  showBatchDialog.value = false;
}

onMounted(() => {
  void store.load(props.projectId);
});
</script>
