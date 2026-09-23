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
  <section v-if="project" class="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6 overflow-y-auto">
    <header class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <code class="rounded bg-surface-alt px-1.5 py-0.5">{{ project.code }}</code>
          <StatusBadge :status="project.status" />
          <span v-if="project.startDate">起 {{ formatDate(project.startDate) }}</span>
          <span v-if="project.endDate">止 {{ formatDate(project.endDate) }}</span>
        </div>
        <h1 class="text-2xl font-semibold text-slate-900">{{ project.name }}</h1>
        <p class="text-sm text-slate-600">客户：{{ project.clientName }}</p>
      </div>
      <button
        class="rounded border border-border px-3 py-1.5 text-sm text-slate-700 hover:bg-surface-alt"
        @click="goBack"
      >
        返回列表
      </button>
    </header>

    <div v-if="loadError" class="rounded border border-red-700 bg-red-900/20 px-4 py-2 text-sm text-red-300">
      加载失败：{{ loadError }}
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- 元数据卡 -->
      <article class="card flex flex-col gap-3">
        <h2 class="text-sm font-medium text-slate-700">项目元数据</h2>
        <dl class="grid grid-cols-3 gap-y-2 text-xs">
          <dt class="text-slate-500">客户</dt>
          <dd class="col-span-2 text-slate-800">{{ project.clientName }}</dd>

          <dt class="text-slate-500">客户网站</dt>
          <dd class="col-span-2 text-slate-800">
            <a v-if="project.clientWebsite" :href="project.clientWebsite" target="_blank" class="text-accent hover:underline">
              {{ project.clientWebsite }}
            </a>
            <span v-else class="text-slate-600">未填</span>
          </dd>

          <dt class="text-slate-500">客户简介</dt>
          <dd class="col-span-2 whitespace-pre-wrap text-slate-800">
            {{ project.clientIntro || "未填" }}
          </dd>

          <dt class="text-slate-500">项目简介</dt>
          <dd class="col-span-2 whitespace-pre-wrap text-slate-800">
            {{ project.projectIntro || "未填" }}
          </dd>

          <dt class="text-slate-500">创建</dt>
          <dd class="col-span-2 text-slate-800">{{ formatDate(project.createdAt) }}</dd>

          <dt class="text-slate-500">更新</dt>
          <dd class="col-span-2 text-slate-800">{{ formatDate(project.updatedAt) }}</dd>
        </dl>
      </article>

      <!-- AI 助手卡（绑定当前项目） -->
      <article class="card flex flex-col gap-3">
        <header class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-slate-700">AI 助手</h2>
          <span class="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-emerald-700">
            已绑定：{{ project.code }}
          </span>
        </header>
        <p class="text-xs text-slate-600">
          对话上下文会自动关联本项目 <code>{{ project.code }}</code>。
          输入 <code>@其他项目名</code> 可临时引用其他项目。
        </p>
        <button
          class="self-start rounded border border-accent/50 px-3 py-1.5 text-xs text-accent hover:bg-accent/10"
          @click="openAiChat"
        >
          打开 AI 对话
        </button>

        <!-- 阶段 6.0g：知识库 -->
        <div class="border-t border-border pt-3">
          <h3 class="mb-2 text-xs font-medium text-slate-600">项目知识库</h3>
          <AdoptToKnowledgeButton :project-id="project.id" />
          <p class="mt-2 text-[11px] text-slate-500">
            入库后，AI 通过 <code>@{{ project.code }}</code> 引用本项目时自动 RAG 召回；
            未入库时只显示 200 token 摘要 + LLM 可用 <code>read_module</code> 按需深入。
          </p>
        </div>
      </article>

      <!-- 项目推进活动计划（阶段 7.0） -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <ActivityListView :project-id="project.id" />
      </article>

      <!-- 调查任务（阶段 7.1） -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <SurveyTaskListView :project-id="project.id" />
      </article>

      <!-- 调查问卷（阶段 7.2） -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <QuestionnaireView :project-id="project.id" />
      </article>

      <!-- 阶段 7.3：markdown_* 模块（11 个共用 MarkdownModuleView） -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_business_current"
          title="业务现状"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_pain_point"
          title="现状问题点 / 痛点"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_improvement"
          title="改善目标"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_proposal"
          title="构想方案"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_non_functional"
          title="非功能需求"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_it_environment"
          title="IT/技术环境"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_risk"
          title="风险分析"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_to_be"
          title="TO-BE 蓝图"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_roi"
          title="ROI 分析"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_precondition"
          title="案件前提条件"
        />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <MarkdownModuleView
          :project-id="project.id"
          kind="markdown_hardware_cost"
          title="硬件设备成本"
        />
      </article>

      <!-- 阶段 7.4a：核心系统用例 / 交付物 / Review -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <UseCaseView :project-id="project.id" />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <DeliverableView :project-id="project.id" />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <ReviewView :project-id="project.id" />
      </article>

      <!-- 阶段 7.4b：功能分析 + 预算设置 + 预算汇总 -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <FunctionListView :project-id="project.id" />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <BudgetSettingsView :project-id="project.id" />
      </article>
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <BudgetSummaryView :project-id="project.id" />
      </article>

      <!-- 阶段 7.4c：提案 PPT 设计 -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <PptView :project-id="project.id" />
      </article>

      <!-- 阶段 7.4d：自定义页面 -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <CustomPagesView :project-id="project.id" />
      </article>

      <!-- 阶段 7.4e：联系人 / 团队成员管理 -->
      <article class="card flex flex-col gap-3">
        <ContactsPanel
          :project-id="project.id"
          :initial-contacts="project.contacts"
          :initial-members="project.teamMembers"
          @updated="refreshProject"
        />
      </article>

      <!-- 阶段 7.4e：邮件历史 -->
      <article class="card flex flex-col gap-3">
        <EmailHistoryPanel :project-id="project.id" />
      </article>

      <!-- 阶段 7.4f：硬件清单 -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <HardwareItemsView :project-id="project.id" />
      </article>

      <!-- 阶段 7.4f：报价单 -->
      <article class="card lg:col-span-2 flex flex-col gap-3">
        <QuoteView :project-id="project.id" />
      </article>

      <!-- 阶段 7.4e：邮件撰写弹窗（全局） -->
      <EmailComposerDialog v-if="emailComposerStore.open && emailComposerStore.projectId === project.id" />
    </div>
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
import { useAiChatStore } from "@frontend/features/ai-chat/stores/ai-chat.store.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";
import StatusBadge from "./components/StatusBadge.vue";
import AdoptToKnowledgeButton from "./components/AdoptToKnowledgeButton.vue";
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

const route = useRoute();
const emailComposerStore = useEmailComposerStore();
const router = useRouter();
const aiStore = useAiChatStore();

const project = ref<ProjectDTO | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

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

function openAiChat(): void {
  aiStore.setCurrentProject(project.value);
  void router.push({ name: "ai" });
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
      // 路由变化时同步绑定项目（用户直接刷新页面进入）
      aiStore.setCurrentProjectId(id);
    }
  },
  { immediate: true },
);

onMounted(() => {
  const id = route.params.id;
  if (typeof id === "string") void load(id);
});
</script>