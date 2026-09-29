<!--
  ProjectDetailView.vue
  =====================
  单项目详情视图（阶段 6.0f + 7.0 + 7.1 + 7.2 + 7.3 + 7.4a + 7.4b + 7.4c + 7.4d + 7.4e + 7.4f）

  设计：
    - 顶部：编号 / 名称 / 状态 / 返回按钮
    - 元数据：客户 / 简介 / 起止时间 / 创建-更新时间
    - 阶段 7.0：项目推进活动计划
    - 阶段 7.1：调查任务
    - 阶段 7.2：调查问卷
    - 阶段 7.3：11 个 markdown_* 模块共用 MarkdownModuleView
    - 阶段 7.4a：核心系统用例 / 交付物清单 / 方案 Review
    - 阶段 7.4b：功能清单 + 成本计算设置 + 预算汇总
    - 阶段 7.4c：提案 PPT 设计
    - 阶段 7.4d：自定义页面（CustomPagesView，多份可重名）
    - 阶段 7.4e：联系人 / 团队成员（ContactsView / TeamMembersView） + 邮件历史（EmailHistoryPanel）
    - 阶段 7.4e：邮件撰写弹窗由 WorkspaceShell 浮动按钮触发（pinia 全局开关）
    - 阶段 7.4f：硬件清单（HardwareItemsView） + 报价单（QuoteView）
    - 阶段 7.4f：报价单生成弹窗由 WorkspaceShell 浮动按钮触发（pinia 全局开关）
    - 底部：AI 助手区域（直接绑定当前项目；切走项目时 AI 上下文自动切换）

  不在本视图范围：
    - 邮件 Composer / View 弹窗（global，由 store.open 控制）
    - 报价单 AiDraft 弹窗（global，由 store.open 控制）
-->
<template>
  <section v-if="project" class="flex h-full flex-col gap-4 p-6 overflow-y-auto">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <StatusBadge :status="project.status" />
          <code class="rounded bg-surface-alt px-1.5 py-0.5">{{ project.code }}</code>
        </div>
        <h1 class="text-2xl font-semibold text-slate-900">{{ project.name }}
          <span v-if="project.startDate || project.endDate" class="ml-3 text-xs text-slate-500">
              {{ project.startDate ? formatDate(project.startDate) : "—" }}
              ~
              {{ project.endDate ? formatDate(project.endDate) : "—" }}
          </span>
          <button
            type="button"
            class="ml-3 align-middle text-xs font-normal text-slate-500 underline-offset-4 hover:text-accent hover:underline"
            @click="openEditDialog"
          >
            编辑
          </button>
        </h1>
        <span class="text-xs text-slate-500">客户：{{ project.clientName }}</span>
        <span class="text-xs ml-3" v-if="project.clientWebsite">
            <a :href="project.clientWebsite" target="_blank" class="text-accent hover:underline">
              {{ project.clientWebsite }}
            </a>
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <KnowledgeStatusBadge :project-id="project.id" />
        <!-- 阶段 1（task20）：主按钮区 —— 状态正向结果（高亮） -->
        <div v-if="canDecideResult" class="flex items-center gap-2">
          <el-button
            v-if="canMarkWon"
            type="success"
            size="small"
            :loading="statusSubmitting && statusDialog?.target === '中标'"
            @click="openStatusDialog('中标')"
          >
            <span class="mr-1">✓</span>中标
          </el-button>
          <el-button
            v-if="canMarkLost"
            type="warning"
            size="small"
            :loading="statusSubmitting && statusDialog?.target === '未中标'"
            @click="openStatusDialog('未中标')"
          >
            <span class="mr-1">✗</span>未中标
          </el-button>
        </div>
        <!-- 阶段 1（task20）：次按钮区 —— 流程控制（link 风格，避免误操作） -->
        <div class="flex items-center gap-3">
          <button
            v-if="canPause"
            type="button"
            class="text-xs text-slate-500 underline-offset-4 hover:text-accent hover:underline"
            @click="openStatusDialog('暂停')"
          >暂停</button>
          <button
            v-if="canAbort"
            type="button"
            class="text-xs text-slate-500 underline-offset-4 hover:text-red-700 hover:underline"
            @click="openAbortDialog"
          >中止</button>
          <button
            type="button"
            class="text-xs text-slate-500 underline-offset-4 hover:text-accent hover:underline"
            @click="onOpenEmail"
          >发送邮件</button>
          <button
            type="button"
            class="text-xs text-slate-500 underline-offset-4 hover:text-accent hover:underline"
            @click="goBack"
          >返回列表</button>
        </div>
      </div>
    </header>

    <div class="flex flex-col gap-1 md:col-span-2">
      <span>工作区路径:</span>
      <span v-if="project.workspacePath" class="rounded bg-surface-alt px-1.5 py-0.5">
        {{ project.workspacePath }}
      </span>
      <span v-else class="text-slate-500">
        ~/Desktop/{{ project.name }}
      </span>
      <!-- 阶段 13（PR #2）：「变更」按钮触发隐藏文件夹选择 input；
           「创建文件夹」按钮调后端 mkdir(recursive) 跨平台创建 -->
      <div class="flex flex-wrap items-center gap-2">
        <button type="button"
          class="text-xs font-normal text-slate-500 underline-offset-4 hover:text-accent hover:underline"
          @click="openFolderPicker">
          变更
        </button>
        <button type="button"
          :disabled="creatingWorkspace"
          class="text-xs font-normal text-slate-500 underline-offset-4 hover:text-accent hover:underline disabled:opacity-50"
          @click="onCreateWorkspace">
          {{ creatingWorkspace ? "创建中…" : "创建文件夹" }}
        </button>
        <!-- 隐藏的文件夹选择 input；用 webkitdirectory 跨 WebView2/WKWebView/WebKitGTK 兼容；
             选完目录后 File.path 给出绝对路径（Chromium/WebKit 行为，依赖 webview 形态） -->
        <input
          ref="folderInputRef"
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          @change="onFolderPicked"
        />
      </div>
      <p v-if="workspaceError" class="text-xs text-red-500">{{ workspaceError }}</p>
    </div>

    <div v-if="loadError" class="rounded border border-red-700 bg-red-900/20 px-4 py-2 text-sm text-red-300">
      加载失败：{{ loadError }}
    </div>

    <!-- 项目元数据：紧凑单卡，全宽 -->
    <article class="card flex flex-col gap-3">
      <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-xs md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <dt class="text-slate-500">客户简介</dt>
          <dd class="whitespace-pre-wrap text-slate-800 line-clamp-6">
            {{ project.clientIntro || "未填" }}
          </dd>
        </div>

        <div class="flex flex-col gap-1">
          <dt class="text-slate-500">项目简介</dt>
          <dd class="whitespace-pre-wrap text-slate-800 line-clamp-6">
            {{ project.projectIntro || "未填" }}
          </dd>
        </div>    
      </dl>
    </article>

    <!-- 业务模块：左侧导航 + 右侧主区（占满剩余高度） -->
    <div class="flex min-h-0 flex-1 items-stretch">
      <ProjectNavSidebar
        :groups="navGroups"
        :active-key="activeModule"
        :width="navWidth"
        @update:active-key="activeModule = $event"
        @update:width="onResizeSidebar"
      />
      <div class="splitter" @mousedown="onSidebarMouseDown"></div>
      <div class="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden pl-4">
        <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <template v-if="markdownModule">
            <MarkdownModuleView
              :project-id="project.id"
              :kind="markdownModule.kind"
              :title="markdownModule.title"
            />
          </template>
          <template v-else-if="activeComponent">
            <component :is="activeComponent" :project-id="project.id" />
          </template>
        </div>
      </div>
    </div>

    <!-- 阶段 7.4e：邮件撰写弹窗（全局） -->
    <EmailComposerDialog v-if="emailComposerStore.open && emailComposerStore.projectId === project.id" />

    <!-- 阶段 7.5：编辑项目信息弹窗 -->
    <ProjectEditDialog
      v-if="editing"
      :project="project"
      :submitting="editSubmitting"
      :error="editError"
      @close="closeEditDialog"
      @submit="onSubmitEdit"
    />

    <!-- 阶段 13（PR #1）：状态变更弹窗（当前仅"中止"，后续 PR 复用同一组件） -->
    <ProjectStatusChangeDialog
      v-if="statusDialog"
      :project="project"
      :target="statusDialog.target"
      :submitting="statusSubmitting"
      :error="statusError"
      @close="closeStatusDialog"
      @submit="onSubmitStatusChange"
    />

    <!-- 阶段 13（PR #2）：工作区路径编辑弹窗 -->
    <ProjectWorkspaceDialog
      v-if="workspaceDialog"
      :project="project"
      :submitting="workspaceSubmitting"
      :error="workspaceError"
      @close="closeWorkspaceDialog"
      @submit="onSubmitWorkspace"
    />
  </section>

  <section v-else-if="!loading" class="mx-auto p-6 text-sm text-slate-500">
    项目不存在或已被删除。
    <button class="ml-2 text-accent hover:underline" @click="goBack">返回列表</button>
  </section>

  <section v-else class="mx-auto p-6 text-sm text-slate-500">加载中…</section>
</template>

<script setup lang="ts">
import { computed, markRaw, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { projectApi } from "./api/project.api.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import StatusBadge from "./components/StatusBadge.vue";
import KnowledgeStatusBadge from "./components/KnowledgeStatusBadge.vue";
import ProjectNavSidebar from "./components/ProjectNavSidebar.vue";
import ActivityListView from "@frontend/features/business-module/components/ActivityListView.vue";
import SurveyTaskListView from "@frontend/features/business-module/components/SurveyTaskListView.vue";
import QuestionnaireView from "@frontend/features/business-module/components/QuestionnaireView.vue";
import MarkdownModuleView from "@frontend/features/business-module/components/MarkdownModuleView.vue";
import UseCaseView from "@frontend/features/business-module/components/UseCaseView.vue";
import DeliverableView from "@frontend/features/business-module/components/DeliverableView.vue";
import FunctionListView from "@frontend/features/business-module/components/FunctionListView.vue";
import BudgetSettingsView from "@frontend/features/business-module/components/BudgetSettingsView.vue";
import BudgetSummaryView from "@frontend/features/business-module/components/BudgetSummaryView.vue";
import PptView from "@frontend/features/business-module/components/PptView.vue";
import CustomPagesView from "@frontend/features/business-module/components/CustomPagesView.vue";
import ContactsView from "@frontend/features/business-module/components/ContactsView.vue";
import TeamMembersView from "@frontend/features/business-module/components/TeamMembersView.vue";
import EmailHistoryPanel from "./components/EmailHistoryPanel.vue";
import EmailComposerDialog from "./components/EmailComposerDialog.vue";
import HardwareItemsView from "@frontend/features/business-module/components/HardwareItemsView.vue";
import QuoteView from "@frontend/features/quote/components/QuoteView.vue";
import ProjectEditDialog from "./components/ProjectEditDialog.vue";
import ProjectStatusChangeDialog from "./components/ProjectStatusChangeDialog.vue";
import ProjectWorkspaceDialog from "./components/ProjectWorkspaceDialog.vue";
import { useEmailComposerStore } from "./stores/email-composer.store.ts";
import { useProjectStore } from "./stores/project.store.ts";
import { useAiChatStore } from "@frontend/features/ai-chat/stores/ai-chat.store.ts";
import { ElMessage } from "element-plus";
import type {
  ChangeProjectStatusInput,
  ProjectStatusValue,
  UpdateProjectInput,
} from "@shared/types/dto/project.ts";

const route = useRoute();
const emailComposerStore = useEmailComposerStore();
const router = useRouter();
const projectStore = useProjectStore();
const aiChatStore = useAiChatStore();

const project = ref<ProjectDTO | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const activeModule = ref<string>("activity");

/* ===== 编辑项目信息 ===== */
const editing = ref(false);
const editError = ref<string | null>(null);
const editSubmitting = ref(false);

function openEditDialog(): void {
  if (!project.value) return;
  editError.value = null;
  editing.value = true;
}

function closeEditDialog(): void {
  if (editSubmitting.value) return;
  editing.value = false;
  editError.value = null;
}

async function onSubmitEdit(input: UpdateProjectInput): Promise<void> {
  if (!project.value) return;
  editError.value = null;
  editSubmitting.value = true;
  try {
    const updated = await projectApi.update(project.value.id, input);
    project.value = updated;
    editing.value = false;
    ElMessage.success("项目信息已更新");
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e);
  } finally {
    editSubmitting.value = false;
  }
}

/* ===== 状态变更（PR #1 中止；task20 扩展 中标/未中标/暂停） ===== */
// 4 个目标状态的可见性矩阵（基于状态机 TRANSITIONS）
// - 中标/未中标：提案中 / 暂停 → 可达
// - 暂停：仅提案中 → 暂停（已暂停不可重复）
// - 中止：提案中 / 暂停 → 可达
const DECIDABLE_STATUSES: ReadonlySet<ProjectStatusValue> = new Set<ProjectStatusValue>(["提案中", "暂停"]);
const PAUSABLE_STATUSES: ReadonlySet<ProjectStatusValue> = new Set<ProjectStatusValue>(["提案中"]);

const canMarkWon = computed(() => project.value ? DECIDABLE_STATUSES.has(project.value.status) : false);
const canMarkLost = computed(() => project.value ? DECIDABLE_STATUSES.has(project.value.status) : false);
const canAbort = computed(() => project.value ? DECIDABLE_STATUSES.has(project.value.status) : false);
const canPause = computed(() => project.value ? PAUSABLE_STATUSES.has(project.value.status) : false);
const canDecideResult = computed(() => canMarkWon.value || canMarkLost.value);

const statusDialog = ref<{ target: ProjectStatusValue } | null>(null);
const statusSubmitting = ref(false);
const statusError = ref<string | null>(null);

function openStatusDialog(target: ProjectStatusValue): void {
  if (!project.value) return;
  statusError.value = null;
  statusDialog.value = { target };
}

function openAbortDialog(): void {
  openStatusDialog("中止");
}

function closeStatusDialog(): void {
  if (statusSubmitting.value) return;
  statusDialog.value = null;
  statusError.value = null;
}

const STATUS_SUCCESS_LABEL: Record<ProjectStatusValue, string> = {
  "新建": "项目已新建",
  "提案中": "项目已进入提案中",
  "暂停": "项目已暂停",
  "中标": "项目已中标 🎉",
  "未中标": "项目已标记为未中标",
  "中止": "项目已中止",
};

async function onSubmitStatusChange(input: ChangeProjectStatusInput): Promise<void> {
  if (!project.value) return;
  statusError.value = null;
  statusSubmitting.value = true;
  try {
    const updated = await projectStore.changeStatus(project.value.id, input);
    project.value = updated;
    statusDialog.value = null;
    ElMessage.success(STATUS_SUCCESS_LABEL[input.target] ?? "项目状态已更新");
  } catch (e) {
    statusError.value = e instanceof Error ? e.message : String(e);
  } finally {
    statusSubmitting.value = false;
  }
}

/* ===== 工作区路径（PR #2） ===== */
const workspaceDialog = ref(false);
const workspaceSubmitting = ref(false);
const workspaceError = ref<string | null>(null);
const folderInputRef = ref<HTMLInputElement | null>(null);
const creatingWorkspace = ref(false);

function openWorkspaceDialog(): void {
  if (!project.value) return;
  workspaceError.value = null;
  workspaceDialog.value = true;
}

function closeWorkspaceDialog(): void {
  if (workspaceSubmitting.value) return;
  workspaceDialog.value = false;
  workspaceError.value = null;
}

/**
 * 阶段 13（PR #2）：「变更」按钮 → 触发隐藏的 <input type="file" webkitdirectory>。
 * 跨 webview 兼容：WebView2（Win）、WKWebView（macOS）、WebKitGTK（Linux）。
 * 选完目录后由 onFolderPicked 读取 File.path（Chromium/WebKit 暴露给 JS 的绝对路径）。
 */
function openFolderPicker(): void {
  if (!project.value) return;
  workspaceError.value = null;
  // 重置 value 让用户重选同一目录也能触发 change
  if (folderInputRef.value) folderInputRef.value.value = "";
  folderInputRef.value?.click();
}

/**
 * 阶段 13（PR #2）：文件夹选完后取 File.path 作为绝对路径，赋值给 workspace。
 * File.path 是非标准但 Chromium/WebKit 都暴露的属性。
 */
async function onFolderPicked(event: Event): Promise<void> {
  if (!project.value) return;
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;
  // 第一个文件的 .path 即选中的文件夹路径（webkit 行为）
  const first = files[0] as File & { path?: string };
  const pickedPath = first.path;
  if (!pickedPath || pickedPath.length === 0) {
    workspaceError.value =
      "当前环境不支持从文件选择器读取绝对路径，请改用「创建文件夹」或手动输入。";
    return;
  }
  workspaceSubmitting.value = true;
  try {
    const updated = await projectStore.setWorkspace(project.value.id, pickedPath);
    project.value = updated;
    ElMessage.success(`工作区路径已更新：${pickedPath}`);
  } catch (e) {
    workspaceError.value = e instanceof Error ? e.message : String(e);
  } finally {
    workspaceSubmitting.value = false;
    input.value = "";
  }
}

/**
 * 阶段 13（PR #2）：「创建文件夹」按钮 → 后端 mkdir(recursive) 跨平台创建；
 * 已存在则只落库不创建；返回最新 ProjectDTO。
 */
async function onCreateWorkspace(): Promise<void> {
  if (!project.value || creatingWorkspace.value) return;
  creatingWorkspace.value = true;
  workspaceError.value = null;
  try {
    const r = await projectStore.ensureWorkspace(project.value.id);
    project.value = r.project;
    if (r.workspace.existed) {
      ElMessage.info(`工作区已存在：${r.workspace.path}`);
    } else if (r.workspace.created) {
      ElMessage.success(`已创建工作区：${r.workspace.path}`);
    } else {
      ElMessage.success(`工作区路径已更新：${r.workspace.path}`);
    }
  } catch (e) {
    workspaceError.value = e instanceof Error ? e.message : String(e);
  } finally {
    creatingWorkspace.value = false;
  }
}

async function onSubmitWorkspace(
  input: { workspacePath: string | null },
): Promise<void> {
  if (!project.value) return;
  workspaceError.value = null;
  workspaceSubmitting.value = true;
  try {
    const updated = await projectStore.setWorkspace(project.value.id, input.workspacePath);
    project.value = updated;
    workspaceDialog.value = false;
    ElMessage.success(
      input.workspacePath === null ? "已清空工作区路径，回退到默认" : "工作区路径已更新",
    );
  } catch (e) {
    workspaceError.value = e instanceof Error ? e.message : String(e);
  } finally {
    workspaceSubmitting.value = false;
  }
}

/* ===== 侧边栏宽度 ===== */
const NAV_WIDTH_MIN = 160;
const NAV_WIDTH_MAX = 360;
const NAV_WIDTH_DEFAULT = 220;
const NAV_WIDTH_STORAGE = "ui.projectDetail.navWidth";
const navWidth = ref<number>(NAV_WIDTH_DEFAULT);

function loadNavWidth(): void {
  try {
    const raw = localStorage.getItem(NAV_WIDTH_STORAGE);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= NAV_WIDTH_MIN && n <= NAV_WIDTH_MAX) {
        navWidth.value = n;
      }
    }
  } catch {
    /* localStorage 不可用时静默回退 */
  }
}

function persistNavWidth(): void {
  try {
    localStorage.setItem(NAV_WIDTH_STORAGE, String(navWidth.value));
  } catch {
    /* 同上 */
  }
}

function onResizeSidebar(px: number): void {
  navWidth.value = px;
}

function onSidebarMouseDown(e: MouseEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = navWidth.value;
  const prevCursor = document.body.style.cursor;
  const prevUserSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  function onMove(ev: MouseEvent): void {
    const delta = ev.clientX - startX;
    const next = Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, startWidth + delta));
    navWidth.value = next;
  }
  function onUp(): void {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevUserSelect;
    persistNavWidth();
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/* ===== 模块元数据：5 组 × 27 项 ===== */
type ModuleKey =
  | "activity" | "survey-task" | "questionnaire"
  | "md_business_current" | "md_pain_point" | "md_improvement"
  | "md_proposal" | "md_non_functional" | "md_it_environment"
  | "md_risk" | "md_to_be" | "md_roi" | "md_precondition"
  | "md_hardware_cost"
  | "use-case" | "deliverable"
  | "function-list" | "budget-settings" | "budget-summary"
  | "hardware-items" | "quote"
  | "ppt" | "custom-pages"
  | "contacts" | "team-members" | "email-history";

const navGroups: Array<{ key: string; label: string; items: Array<{ key: ModuleKey; label: string }> }> = [
  {
    key: "research",
    label: "调研",
    items: [
      { key: "activity", label: "项目推进活动计划" },
      { key: "survey-task", label: "调查任务" },
      { key: "questionnaire", label: "调查问卷" },
      { key: "md_business_current", label: "业务现状" },
      { key: "md_pain_point", label: "现状问题点 / 痛点" },
      { key: "md_improvement", label: "改善目标" },
    ],
  },
  {
    key: "design",
    label: "方案设计",
    items: [
      { key: "md_proposal", label: "构想方案" },
      { key: "md_non_functional", label: "非功能需求" },
      { key: "md_it_environment", label: "IT/技术环境" },
      { key: "md_risk", label: "风险分析" },
      { key: "md_to_be", label: "TO-BE 蓝图" },
      { key: "md_roi", label: "ROI 分析" },
      { key: "md_precondition", label: "案件前提条件" },
      { key: "use-case", label: "核心系统用例" },
      { key: "deliverable", label: "交付物清单" },
      { key: "custom-pages", label: "自定义页面" },
    ],
  },
  {
    key: "quote",
    label: "报价",
    items: [
      { key: "hardware-items", label: "硬件清单" },
      { key: "function-list", label: "功能清单" },
      { key: "budget-settings", label: "预算设置" },
      { key: "budget-summary", label: "预算汇总" },
      { key: "quote", label: "报价单" },
    ],
  },
  {
    key: "deliverables",
    label: "交付物",
    items: [
      { key: "ppt", label: "提案 PPT 设计" },
    ],
  },
  {
    key: "communication",
    label: "沟通",
    items: [
      { key: "contacts", label: "客户联系人" },
      { key: "team-members", label: "团队成员" },
      { key: "email-history", label: "邮件历史" },
    ],
  },
];

/* ===== 当前选中模块 → 组件 + props ===== */
const MARKDOWN_MODULES: Record<string, { kind: BusinessModuleKind; title: string }> = {
  md_business_current: { kind: "markdown_business_current", title: "业务现状" },
  md_pain_point: { kind: "markdown_pain_point", title: "现状问题点 / 痛点" },
  md_improvement: { kind: "markdown_improvement", title: "改善目标" },
  md_proposal: { kind: "markdown_proposal", title: "构想方案" },
  md_non_functional: { kind: "markdown_non_functional", title: "非功能需求" },
  md_it_environment: { kind: "markdown_it_environment", title: "IT/技术环境" },
  md_risk: { kind: "markdown_risk", title: "风险分析" },
  md_to_be: { kind: "markdown_to_be", title: "TO-BE 蓝图" },
  md_roi: { kind: "markdown_roi", title: "ROI 分析" },
  md_precondition: { kind: "markdown_precondition", title: "案件前提条件" },
  md_hardware_cost: { kind: "markdown_hardware_cost", title: "硬件设备成本" },
};

const MarkdownModuleViewCmp = markRaw(MarkdownModuleView);

const markdownModule = computed(() => MARKDOWN_MODULES[activeModule.value] ?? null);

const activeComponent = computed(() => {
  const key = activeModule.value;
  switch (key) {
    case "activity": return markRaw(ActivityListView);
    case "survey-task": return markRaw(SurveyTaskListView);
    case "questionnaire": return markRaw(QuestionnaireView);
    case "use-case": return markRaw(UseCaseView);
    case "deliverable": return markRaw(DeliverableView);
    case "function-list": return markRaw(FunctionListView);
    case "budget-settings": return markRaw(BudgetSettingsView);
    case "budget-summary": return markRaw(BudgetSummaryView);
    case "ppt": return markRaw(PptView);
    case "custom-pages": return markRaw(CustomPagesView);
    case "hardware-items": return markRaw(HardwareItemsView);
    case "quote": return markRaw(QuoteView);
    case "email-history": return markRaw(EmailHistoryPanel);
    case "contacts": return markRaw(ContactsView);
    case "team-members": return markRaw(TeamMembersView);
    default:
      // 11 个 markdown_* 共用一个 MarkdownModuleView
      if (key in MARKDOWN_MODULES) return MarkdownModuleViewCmp;
      return null;
  }
});

/* ===== 数据加载 ===== */
async function load(id: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  project.value = null;
  try {
    project.value = await projectApi.get(id);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

/** ContactsView / TeamMembersView updated 后同步刷新（contacts / teamMembers 变了） */
async function refreshProject(): Promise<void> {
  if (project.value) {
    project.value = await projectApi.get(project.value.id);
  }
}

function goBack(): void {
  void router.push({ name: "projects" });
}

function onOpenEmail(): void {
  if (project.value) emailComposerStore.openComposer(project.value.id);
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === "string" && id.length > 0) {
      void load(id);
      // 阶段 13（PR #4）：跨项目导航时刷新 session 列表。
      void aiChatStore.loadSessions(id);
    }
  },
  { immediate: true },
);

onMounted(() => {
  loadNavWidth();
  const id = route.params.id;
  if (typeof id === "string") {
    void load(id);
    // 阶段 13（PR #4）：进项目后让 AI chat 侧边栏显示该项目的 session 列表。
    // ProjectListView 已经在导航时调过 setCurrentProjectId；这里只需 loadSessions。
    void aiChatStore.loadSessions(id);
  }
});
</script>