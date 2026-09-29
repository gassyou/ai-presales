/**
 * DefaultAutoModeContextProvider —— 阶段 12（任务 sprint 12）：auto-mode 真实 context provider
 *
 * 把项目各模块内容聚合成 Record<ContextInputKind, string>：
 *   - project_meta              → "code / name / clientName / status"
 *   - markdown_business_current → project_meta + markdown 模块内容（first item）
 *   - markdown_pain_point       → 同上
 *   - use_case                  → structured_modules.listUseCases → 序列化
 *   - deliverable               → structured_modules.listDeliverables → 序列化
 *   - questionnaire_outline     → survey-questionnaire.getOutline → JSON
 *   - survey_task_results       → survey-task.list → 序列化
 *   - function_list             → structured_modules.listFunctionList → 序列化
 *
 * 缺失的模块返回 ""（orchestrator/worker 用 Partial 容错）。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { AutoModeContextProvider, ContextInputKind } from "@backend/domain/auto-mode/auto-mode.ts";
import type { ProjectService } from "@backend/application/project/project.service.ts";
import type { MarkdownModuleService } from "@backend/application/business-module/markdown-module.service.ts";
import type { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import type { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import type { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";

export interface DefaultAutoModeContextProviderDeps {
  readonly projectService: ProjectService;
  readonly markdownModuleService: MarkdownModuleService;
  readonly structuredModulesUseCase: StructuredModulesUseCase;
  readonly surveyQuestionnaireUseCase: SurveyQuestionnaireUseCase;
  readonly surveyTaskUseCase: SurveyTaskUseCase;
}

/** 列出每个 markdown_* kind（来自 BusinessModuleKind，但这里只关心 markdown_*） */
const MARKDOWN_KINDS: readonly ContextInputKind[] = [
  "markdown_business_current",
  "markdown_pain_point",
  "markdown_improvement",
];

export class DefaultAutoModeContextProvider implements AutoModeContextProvider {
  constructor(private readonly deps: DefaultAutoModeContextProviderDeps) {}

  async loadContext(
    projectId: ProjectId,
    kinds: readonly ContextInputKind[],
  ): Promise<Readonly<Partial<Record<ContextInputKind, string>>>> {
    const out: Partial<Record<ContextInputKind, string>> = {};

    // project_meta 总是先加载（其他模块可能依赖）
    if (kinds.includes("project_meta") || MARKDOWN_KINDS.some((k) => kinds.includes(k))) {
      const projR = await this.deps.projectService.getProject(projectId);
      if (projR.ok) {
        out.project_meta = formatProjectMeta(projR.value);
      }
    }

    // markdown_* 模块
    for (const kind of MARKDOWN_KINDS) {
      if (!kinds.includes(kind)) continue;
      const r = await this.deps.markdownModuleService.get(projectId, kind as never);
      if (r.ok && r.value) {
        out[kind] = r.value.content;
      } else {
        out[kind] = "";
      }
    }

    if (kinds.includes("use_case")) {
      const list = await this.deps.structuredModulesUseCase.listUseCases(projectId as never);
      out.use_case = serializeStructuredList(list, "use_case");
    }
    if (kinds.includes("deliverable")) {
      const list = await this.deps.structuredModulesUseCase.listDeliverables(projectId as never);
      out.deliverable = serializeStructuredList(list, "deliverable");
    }
    if (kinds.includes("function_list")) {
      const list = await this.deps.structuredModulesUseCase.listFunctions(projectId as never);
      out.function_list = serializeStructuredList(list, "function_list");
    }
    if (kinds.includes("questionnaire_outline")) {
      const r = await this.deps.surveyQuestionnaireUseCase.getOutline(projectId as never);
      out.questionnaire_outline = r.ok ? JSON.stringify(r.value ?? {}) : "";
    }
    if (kinds.includes("survey_task_results")) {
      const list = await this.deps.surveyTaskUseCase.list(projectId as never);
      out.survey_task_results = serializeSurveyTasks(list);
    }

    return out;
  }
}

function formatProjectMeta(p: { code: string; name: string; clientName: string; status: string }): string {
  return [
    `# 项目元信息`,
    `- 编号: ${p.code}`,
    `- 名称: ${p.name}`,
    `- 客户: ${p.clientName}`,
    `- 状态: ${p.status}`,
  ].join("\n");
}

function serializeStructuredList(
  items: ReadonlyArray<{ id: string; title: string }>,
  kind: string,
): string {
  if (!items || items.length === 0) return "";
  return items
    .map((it) => `- [${kind}] ${it.title} (id=${it.id})`)
    .join("\n");
}

function serializeSurveyTasks(
  tasks: ReadonlyArray<{ id: string; title: string; result?: string }>,
): string {
  if (!tasks || tasks.length === 0) return "";
  return tasks
    .map((t) => {
      const r = t.result ? `\n  结果: ${t.result}` : "\n  结果: (未完成)";
      return `- ${t.title}${r}`;
    })
    .join("\n");
}