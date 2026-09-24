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
    - 阶段 7.4e：联系人 / 团队成员（ContactsPanel） + 邮件历史（EmailHistoryPanel）
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
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded bg-emerald-600 px-3 text-xs font-medium text-white transition hover:bg-emerald-700"
          @click="onOpenQuote"
        >
          <span>生成报价单</span>
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          @click="onOpenEmail"
        >
          <span>发送邮件</span>
        </button>
        <button
          type="button"
          class="text-xs text-slate-500 underline-offset-4 hover:text-accent hover:underline"
          @click="goBack"
        >
          返回列表
        </button>
      </div>
    </header>

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

    <!-- 业务模块：左侧导航 + 右侧主区 -->
    <div class="flex min-h-0 flex-1 items-stretch">
      <ProjectNavSidebar
        :groups="navGroups"
        :active-key="activeModule"
        :width="navWidth"
        @update:active-key="activeModule = $event"
        @update:width="onResizeSidebar"
      />
      <div class="splitter" @mousedown="onSidebarMouseDown"></div>
      <div class="flex-1 min-w-0 overflow-y-auto pl-4">
        <template v-if="activeModule === 'contacts' || activeModule === 'team-members'">
          <ContactsPanel
            :project-id="project.id"
            :initial-contacts="project.contacts"
            :initial-members="project.teamMembers"
            @updated="refreshProject"
          />
        </template>
        <template v-else-if="markdownModule">
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

    <!-- 阶段 7.4e：邮件撰写弹窗（全局） -->
    <EmailComposerDialog v-if="emailComposerStore.open && emailComposerStore.projectId === project.id" />
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
import ReviewView from "@frontend/features/business-module/components/ReviewView.vue";
import FunctionListView from "@frontend/features/business-module/components/FunctionListView.vue";
import BudgetSettingsView from "@frontend/features/business-module/components/BudgetSettingsView.vue";
import BudgetSummaryView from "@frontend/features/business-module/components/BudgetSummaryView.vue";
import PptView from "@frontend/features/business-module/components/PptView.vue";
import CustomPagesView from "@frontend/features/business-module/components/CustomPagesView.vue";
import ContactsPanel from "./components/ContactsPanel.vue";
import EmailHistoryPanel from "./components/EmailHistoryPanel.vue";
import EmailComposerDialog from "./components/EmailComposerDialog.vue";
import HardwareItemsView from "@frontend/features/business-module/components/HardwareItemsView.vue";
import QuoteView from "@frontend/features/quote/components/QuoteView.vue";
import { useEmailComposerStore } from "./stores/email-composer.store.ts";
import { useQuoteComposerStore } from "@frontend/features/quote/stores/quote-composer.store.ts";

const route = useRoute();
const emailComposerStore = useEmailComposerStore();
const quoteComposerStore = useQuoteComposerStore();
const router = useRouter();

const project = ref<ProjectDTO | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const activeModule = ref<string>("activity");

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
  | "use-case" | "deliverable" | "review"
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
      { key: "review", label: "方案 Review" },
    ],
  },
  {
    key: "quote",
    label: "报价",
    items: [
      { key: "md_hardware_cost", label: "硬件设备成本" },
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
      { key: "custom-pages", label: "自定义页面" },
    ],
  },
  {
    key: "communication",
    label: "沟通",
    items: [
      { key: "contacts", label: "联系人" },
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

const ContactsPanelCmp = markRaw(ContactsPanel);
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
    case "review": return markRaw(ReviewView);
    case "function-list": return markRaw(FunctionListView);
    case "budget-settings": return markRaw(BudgetSettingsView);
    case "budget-summary": return markRaw(BudgetSummaryView);
    case "ppt": return markRaw(PptView);
    case "custom-pages": return markRaw(CustomPagesView);
    case "hardware-items": return markRaw(HardwareItemsView);
    case "quote": return markRaw(QuoteView);
    case "email-history": return markRaw(EmailHistoryPanel);
    case "contacts":
    case "team-members":
      return ContactsPanelCmp;
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

/** ContactsPanel updated 后同步刷新（contacts / teamMembers 变了） */
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

function onOpenQuote(): void {
  if (project.value) quoteComposerStore.openComposer(project.value.id);
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
    }
  },
  { immediate: true },
);

onMounted(() => {
  loadNavWidth();
  const id = route.params.id;
  if (typeof id === "string") void load(id);
});
</script>