<!--
  SurveyTaskListView.vue
  =====================
  「调查任务」表格视图 + 调查结果 markdown 编辑（阶段 7.1 + 重构）。

  需求：
    1. 表格列：任务名 / 主题 / 状态 / 调查结果摘要 / 操作
    2. 每个任务可点开抽屉查看/编辑调查结果（markdown）
    3. 一键批量 / 新建 / 执行 / 终止 / 采纳 / 不采用 / 删除
-->
<template>
  <section class="card flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium text-slate-700">
        调查任务（{{ tasks.length }}）
      </h2>
      <div class="flex gap-2">
        <!-- 阶段 B24：移除「一键批量」按钮（用户要求；保留 store.batchGenerate + 后端 /survey_task/items?action=batchGenerate 路由供 auto-mode sub-agent 调用） -->
        <el-button size="small" @click="showCreate = true">
          + 新建调查
        </el-button>
      </div>
    </header>

    <p v-if="store.error" class="text-xs text-red-300">{{ store.error }}</p>

    <div v-if="tasks.length === 0" class="rounded border border-dashed border-border bg-white/30 p-4 text-center text-xs text-slate-500">
      暂无调查任务。点击右上角新建。
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-surface-alt/90 text-left text-slate-600 backdrop-blur">
          <tr class="border-b border-border">
            <th class="py-2 pl-2">任务名称</th>
            <th class="w-36 py-2">主题</th>
            <th class="w-24 py-2">状态</th>
            <th class="w-20 py-2">采用</th>
            <th class="w-32 py-2">开始 / 完成</th>
            <th class="w-20 py-2 text-right pr-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in tasks"
            :key="t.id"
            class="border-b border-border/60 hover:bg-surface-alt/40"
          >
            <td class="py-2 pl-2 font-medium text-slate-900">{{ t.title }}</td>
            <td class="py-2 text-slate-600 line-clamp-1 max-w-[180px]" :title="t.topicHint">
              {{ t.topicHint || "—" }}
            </td>
            <td class="py-2">
              <span :class="taskStatusClass(effectiveStatus(t))">
                <el-icon v-if="effectiveStatus(t) === 'running'" class="is-loading mr-1">
                  <Loading />
                </el-icon>
                {{ taskStatusLabel(effectiveStatus(t), t.startedAt) }}
              </span>
            </td>
            <td class="py-2">
              <span :class="adoptionClass(t.adoptionStatus)">{{ adoptionLabel(t.adoptionStatus) }}</span>
            </td>
            <td class="py-2 text-slate-500 text-[11px]">
              <div>{{ t.startedAt ? formatTime(t.startedAt) : "—" }}</div>
              <div v-if="t.completedAt">→ {{ formatTime(t.completedAt) }}</div>
            </td>
            <td class="py-2 text-right pr-2">
              <el-button link type="primary" size="small" @click="openResult(t)">结果</el-button>
              <el-button
                link
                type="primary"
                size="small"
                :disabled="effectiveStatus(t) === 'running'"
                @click="openEdit(t)"
              >编辑</el-button>
              <el-button
                v-if="effectiveStatus(t) === 'idle'"
                link
                type="success"
                size="small"
                @click="onStart(t.id)"
              >开始调查</el-button>
              <el-button
                v-else-if="effectiveStatus(t) === 'running'"
                link
                type="warning"
                size="small"
                @click="onStop(t.id)"
              >终止</el-button>
              <el-button
                v-if="t.adoptionStatus !== 'adopted'"
                link
                type="primary"
                size="small"
                @click="onAdopt(t.id)"
              >采用</el-button>
              <el-button
                v-if="t.adoptionStatus !== 'unadopted'"
                link
                type="info"
                size="small"
                @click="onUnadopt(t.id)"
              >不采用</el-button>
              <el-button link type="danger" size="small" @click="onDelete(t.id)">删</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
          <el-input v-model="form.topicHint" placeholder="如：客户背景信息、行业背景" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          详细调查内容
          <el-input v-model="form.detail" type="textarea" :rows="4" placeholder="需要 AI 调查的要点" />
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="showCreate = false">取消</el-button>
          <el-button type="primary" @click="onCreate">创建</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 编辑对话框（基础字段：任务名 / 主题 / 内容） -->
    <el-dialog
      v-model="showEdit"
      :title="editTitle"
      width="480px"
      :close-on-click-modal="false"
    >
      <form class="flex flex-col gap-3" @submit.prevent="onSaveEdit">
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          任务名称 *
          <el-input v-model="editForm.title" required />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          主题提示
          <el-input v-model="editForm.topicHint" placeholder="如：客户背景信息、行业背景" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-slate-600">
          详细调查内容
          <el-input v-model="editForm.detail" type="textarea" :rows="4" placeholder="需要 AI 调查的要点" />
        </label>
        <p v-if="editError" class="text-xs text-red-300">{{ editError }}</p>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="closeEdit">取消</el-button>
          <el-button type="primary" :loading="editSaving" @click="onSaveEdit">保存</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 调查结果抽屉（markdown 编辑 + 保存） -->
    <el-drawer
      v-model="drawerOpen"
      :title="drawerTitle"
      direction="rtl"
      size="720px"
      :close-on-click-modal="false"
    >
      <div v-if="drawerTask" class="flex h-full flex-col gap-3 px-1">
        <div class="rounded border border-border bg-surface-alt/40 p-3 text-xs text-slate-600">
          <div class="font-medium text-slate-700">{{ drawerTask.title }}</div>
          <div class="mt-1">主题：{{ drawerTask.topicHint || "—" }}</div>
        </div>

        <label class="flex flex-col gap-1 text-xs text-slate-600">
          调查结果（Markdown）
          <div class="mt-1 flex-1 overflow-hidden rounded border border-border">
            <MarkdownEditor
              v-model="resultDraft"
              :fill-height="false"
              placeholder="调查结果 / 关键发现…"
            />
          </div>
        </label>

        <p v-if="drawerError" class="text-xs text-red-300">{{ drawerError }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <el-button @click="drawerOpen = false">取消</el-button>
          <el-button type="primary" :loading="drawerSaving" @click="onSaveResult">保存</el-button>
        </div>
      </div>
    </el-drawer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { Loading } from "@element-plus/icons-vue";
import { useSurveyTaskStore } from "../stores/survey-task.store.ts";
import { businessModuleApi } from "../api/business-module.api.ts";
import type { SurveyTaskResult, SurveyTaskStatus } from "../api/survey-task.api.ts";
import { formatElapsed } from "../lib/format-elapsed.ts";
import MarkdownEditor from "@frontend/shared/ui/MarkdownEditor.vue";

const props = defineProps<{ projectId: string }>();
const store = useSurveyTaskStore();
const tasks = computed(() => store.getList(props.projectId));

const showCreate = ref(false);
const form = reactive({ title: "", topicHint: "", detail: "" });

const drawerOpen = ref(false);
const drawerTask = ref<SurveyTaskResult | null>(null);
const drawerSaving = ref(false);
const drawerError = ref<string | null>(null);
const resultDraft = ref<string>("");

const drawerTitle = computed(() =>
  drawerTask.value ? `调查结果 · ${drawerTask.value.title}` : "调查结果",
);

// 编辑对话框状态
const showEdit = ref(false);
const editTask = ref<SurveyTaskResult | null>(null);
const editSaving = ref(false);
const editError = ref<string | null>(null);
const editForm = reactive({ title: "", topicHint: "", detail: "" });

const editTitle = computed(() =>
  editTask.value ? `编辑调查任务 · ${editTask.value.title}` : "编辑调查任务",
);

function effectiveStatus(t: SurveyTaskResult): SurveyTaskStatus {
  return store.getLiveStatus(t.id) ?? t.taskStatus;
}

// 每秒驱动「执行中 Ns」文案重算
const now = ref(Date.now());
const tickHandle = setInterval(() => {
  now.value = Date.now();
}, 1000);
onUnmounted(() => clearInterval(tickHandle));

function taskStatusLabel(s: SurveyTaskStatus, startedAt?: string): string {
  switch (s) {
    case "idle": return "待执行";
    case "running": {
      const elapsed = formatElapsed(startedAt, now.value);
      return elapsed ? `执行中 ${elapsed}` : "执行中";
    }
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

async function onCreate(): Promise<void> {
  await store.create(props.projectId, {
    title: form.title,
    topicHint: form.topicHint || undefined,
    content: form.detail,
  });
  showCreate.value = false;
  form.title = "";
  form.topicHint = "";
  form.detail = "";
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

function openResult(t: SurveyTaskResult): void {
  drawerTask.value = t;
  resultDraft.value = t.resultContent ?? "";
  drawerError.value = null;
  drawerOpen.value = true;
}

function openEdit(t: SurveyTaskResult): void {
  editTask.value = t;
  editForm.title = t.title;
  editForm.topicHint = t.topicHint ?? "";
  // 「详细调查内容」独立字段 detail；与「调查结果」(resultContent) 不再共用。
  editForm.detail = t.detail ?? "";
  editError.value = null;
  showEdit.value = true;
}

function closeEdit(): void {
  showEdit.value = false;
  editTask.value = null;
  editError.value = null;
}

/** 解析 SurveyTaskResult 上透传的 payload_json 字符串；损坏时回退到空对象。 */
function parseStoredPayload(t: SurveyTaskResult): Record<string, unknown> {
  if (!t.payloadJson) return {};
  try {
    const obj = JSON.parse(t.payloadJson) as unknown;
    return (obj && typeof obj === "object") ? obj as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function onSaveEdit(): Promise<void> {
  const t = editTask.value;
  if (!t) return;
  if (!editForm.title.trim()) {
    editError.value = "请填写任务名称";
    return;
  }
  editSaving.value = true;
  editError.value = null;
  try {
    // 合并 payload_json：保留生命周期字段（taskStatus / startedAt / ...），
    // 仅覆盖用户可编辑的 topicHint / detail。content (调查结果) 不再被触碰。
    const existingPayload = parseStoredPayload(t);
    const nextPayload = {
      ...existingPayload,
      topicHint: editForm.topicHint || undefined,
      detail: editForm.detail,
    };
    await businessModuleApi.update(t.id, {
      title: editForm.title.trim(),
      payloadJson: JSON.stringify(nextPayload),
    });
    await store.load(props.projectId);
    showEdit.value = false;
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e);
  } finally {
    editSaving.value = false;
  }
}

async function onSaveResult(): Promise<void> {
  const t = drawerTask.value;
  if (!t) return;
  drawerSaving.value = true;
  drawerError.value = null;
  try {
    // 后端 PATCH /api/modules/items/{id} body.content 即可
    await businessModuleApi.update(t.id, { content: resultDraft.value });
    await store.load(props.projectId);
    drawerOpen.value = false;
  } catch (e) {
    drawerError.value = e instanceof Error ? e.message : String(e);
  } finally {
    drawerSaving.value = false;
  }
}

onMounted(() => {
  void store.load(props.projectId);
});
</script>