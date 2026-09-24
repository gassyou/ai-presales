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
          <code class="rounded bg-surface-alt px-1.5 py-0.5">{{ project.code }}</code>
          <StatusBadge :status="project.status" />
          <span>客户：{{ project.clientName }}</span>
        </div>
        <h1 class="text-2xl font-semibold text-slate-900">{{ project.name }}</h1>
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
          class="inline-flex h-8 items-center gap-1.5 rounded bg-emerald-600 px-3 text-xs font-medium text-white transition hover:bg-emerald-700"
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
        <div class="flex items-center gap-2">
          <dt class="shrink-0 text-slate-500">客户网站</dt>
          <dd class="truncate text-slate-800">
            <a v-if="project.clientWebsite" :href="project.clientWebsite" target="_blank" class="text-accent hover:underline">
              {{ project.clientWebsite }}
            </a>
            <span v-else class="text-slate-400">未填</span>
          </dd>
        </div>

        <div class="flex items-center gap-2">
          <dt class="shrink-0 text-slate-500">起止日期</dt>
          <dd class="truncate text-slate-800">
            <span v-if="project.startDate || project.endDate">
              {{ project.startDate ? formatDate(project.startDate) : "—" }}
              ~
              {{ project.endDate ? formatDate(project.endDate) : "—" }}
            </span>
            <span v-else class="text-slate-400">未填</span>
          </dd>
        </div>

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

    <!-- 业务模块 Tab（按阶段顺序） -->
    <el-tabs v-model="activeModule" type="border-card">
      <el-tab-pane label="项目推进活动计划" name="activity">
        <ActivityListView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="调查任务" name="survey-task">
        <SurveyTaskListView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="调查问卷" name="questionnaire">
        <QuestionnaireView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="业务现状" name="md_business_current">
        <MarkdownModuleView :project-id="project.id" kind="markdown_business_current" title="业务现状" />
      </el-tab-pane>
      <el-tab-pane label="现状问题点 / 痛点" name="md_pain_point">
        <MarkdownModuleView :project-id="project.id" kind="markdown_pain_point" title="现状问题点 / 痛点" />
      </el-tab-pane>
      <el-tab-pane label="改善目标" name="md_improvement">
        <MarkdownModuleView :project-id="project.id" kind="markdown_improvement" title="改善目标" />
      </el-tab-pane>
      <el-tab-pane label="构想方案" name="md_proposal">
        <MarkdownModuleView :project-id="project.id" kind="markdown_proposal" title="构想方案" />
      </el-tab-pane>
      <el-tab-pane label="非功能需求" name="md_non_functional">
        <MarkdownModuleView :project-id="project.id" kind="markdown_non_functional" title="非功能需求" />
      </el-tab-pane>
      <el-tab-pane label="IT/技术环境" name="md_it_environment">
        <MarkdownModuleView :project-id="project.id" kind="markdown_it_environment" title="IT/技术环境" />
      </el-tab-pane>
      <el-tab-pane label="风险分析" name="md_risk">
        <MarkdownModuleView :project-id="project.id" kind="markdown_risk" title="风险分析" />
      </el-tab-pane>
      <el-tab-pane label="TO-BE 蓝图" name="md_to_be">
        <MarkdownModuleView :project-id="project.id" kind="markdown_to_be" title="TO-BE 蓝图" />
      </el-tab-pane>
      <el-tab-pane label="ROI 分析" name="md_roi">
        <MarkdownModuleView :project-id="project.id" kind="markdown_roi" title="ROI 分析" />
      </el-tab-pane>
      <el-tab-pane label="案件前提条件" name="md_precondition">
        <MarkdownModuleView :project-id="project.id" kind="markdown_precondition" title="案件前提条件" />
      </el-tab-pane>
      <el-tab-pane label="硬件设备成本" name="md_hardware_cost">
        <MarkdownModuleView :project-id="project.id" kind="markdown_hardware_cost" title="硬件设备成本" />
      </el-tab-pane>
      <el-tab-pane label="核心系统用例" name="use-case">
        <UseCaseView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="交付物清单" name="deliverable">
        <DeliverableView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="方案 Review" name="review">
        <ReviewView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="功能清单" name="function-list">
        <FunctionListView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="预算设置" name="budget-settings">
        <BudgetSettingsView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="预算汇总" name="budget-summary">
        <BudgetSummaryView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="提案 PPT 设计" name="ppt">
        <PptView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="自定义页面" name="custom-pages">
        <CustomPagesView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="硬件清单" name="hardware-items">
        <HardwareItemsView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="报价单" name="quote">
        <QuoteView :project-id="project.id" />
      </el-tab-pane>
      <el-tab-pane label="联系人" name="contacts">
        <ContactsPanel
          :project-id="project.id"
          :initial-contacts="project.contacts"
          :initial-members="project.teamMembers"
          @updated="refreshProject"
        />
      </el-tab-pane>
      <el-tab-pane label="团队成员" name="team-members">
        <ContactsPanel
          :project-id="project.id"
          :initial-contacts="project.contacts"
          :initial-members="project.teamMembers"
          @updated="refreshProject"
        />
      </el-tab-pane>
      <el-tab-pane label="邮件历史" name="email-history">
        <EmailHistoryPanel :project-id="project.id" />
      </el-tab-pane>
    </el-tabs>

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
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { projectApi } from "./api/project.api.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";
import StatusBadge from "./components/StatusBadge.vue";
import KnowledgeStatusBadge from "./components/KnowledgeStatusBadge.vue";
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
  const id = route.params.id;
  if (typeof id === "string") void load(id);
});
</script>