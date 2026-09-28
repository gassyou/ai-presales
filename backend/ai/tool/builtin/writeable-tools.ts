/**
 * WriteableTools —— 阶段 H 计划
 *
 * 暴露给 AI sub-agent 的写入类工具。设计上：
 *   - 所有写工具要求 projectCodeOrName（防 LLM 误改错项目）
 *   - sideEffect = "write"，由 ToolExecutor 单独做安全审计（如未来接审批流）
 *   - 每个工具接受 dryRun: true 选参；true 时只描述"将做什么"不真做（集成测试友好）
 *   - 错误通过 Tool.fail(msg) 返给 LLM，让模型能恢复
 *
 * 工具清单：
 *   1. write_project_status        —— 修改项目状态（"新建" → "提案中/暂停/中标/未中标"）
 *   2. create_activity             —— 新增项目推进活动
 *   3. create_function_list_item   —— 功能清单加一条
 *   4. update_markdown_module      —— 写入 11 个 markdown_* 模块正文
 *   5. save_questionnaire_outline  —— 保存调查问卷脑图
 *   6. set_primary_contact         —— 把某个联系人设为主联系人
 *   7. create_survey_task          —— 新增调查任务
 *
 * 注意：本批只覆盖核心可写面（项目元/活动/功能/markdown/问卷/联系人/调查任务）。
 *       后续可按需补 contacts / team-members 的 CRUD、PPT 页增删、报价单等。
 */

import type { Tool } from "../tool.ts";
import { fail, ok } from "../tool.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import type { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import type { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import type { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import type { ProjectService } from "@backend/application/project/project.service.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { IProjectContactsRepository } from "@backend/domain/project/project-contacts.repository.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

// ===== 通用：解析 projectCodeOrName → ProjectId =====

export interface ResolveProjectArgs {
  /** projectRepo / contactsRepo / 等的"按 token 找项目"接口 */
  readonly projectRepo: { findByMentionToken(token: string): Promise<{ id: ProjectId; code: string; name: string; status: string } | null> };
}

async function resolveProjectId(
  token: string,
  deps: ResolveProjectArgs,
): Promise<{ id: ProjectId; code: string; name: string; status: string } | null> {
  const t = token.trim();
  if (!t) return null;
  return deps.projectRepo.findByMentionToken(t);
}

// ===== 1. write_project_status =====

export interface WriteProjectStatusArgs {
  projectCodeOrName: string;
  /** 5 态："新建" | "提案中" | "暂停" | "中标" | "未中标"。
   *  "中标" / "未中标" / "暂停" 需要 reason 字段（市场惯例：客户/内部必填） */
  status: "新建" | "提案中" | "暂停" | "中标" | "未中标";
  /** 仅当 dryRun=true 时不实际写入，仅返"将做什么"摘要 */
  dryRun?: boolean;
  /** 状态切换原因（中标/未中标/暂停时必填；其他选填） */
  reason?: string;
}

export interface WriteProjectStatusResult {
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly dryRun: boolean;
}

export interface WriteProjectStatusToolDeps {
  projectService: ProjectService;
  projectRepo: ResolveProjectArgs["projectRepo"];
  logger: Logger;
}

export class WriteProjectStatusTool implements Tool<WriteProjectStatusArgs, WriteProjectStatusResult> {
  readonly name = "write_project_status";
  readonly description =
    "修改一个项目的状态。可选值：新建 / 进行中 / 已完成 / 已搁置。" +
    "通常用在项目推进阶段切换（开始 / 完成 / 搁置）。" +
    "传 dryRun=true 时不实际写入，仅描述会做什么；默认 false。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "status"],
    properties: {
      projectCodeOrName: { type: "string", description: "项目编号（如 2026-00001）或项目名称" },
      status: { type: "string", enum: ["新建", "提案中", "暂停", "中标", "未中标"] },
      dryRun: { type: "boolean", default: false },
      reason: { type: "string", description: "状态切换原因（中标/未中标/暂停时必填）" },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: WriteProjectStatusToolDeps) {}

  async execute(args: WriteProjectStatusArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<WriteProjectStatusResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    if (args.status === proj.status) {
      return fail(`project ${proj.code} is already in status "${args.status}"`);
    }
    if ((args.status === "中标" || args.status === "未中标" || args.status === "暂停") && (!args.reason || !args.reason.trim())) {
      return fail(`reason is required when transitioning to "${args.status}"`);
    }
    if (args.dryRun) {
      return ok({ projectId: proj.id, projectCode: proj.code, projectName: proj.name, fromStatus: proj.status, toStatus: args.status, dryRun: true });
    }
    const result = await this.deps.projectService.changeProjectStatus(
      proj.id,
      args.status,
      args.reason ? { reason: args.reason } : undefined,
    );
    if (!result.ok) return fail(result.error.message);
    this.deps.logger.info("write_project_status", { projectId: proj.id, from: proj.status, to: args.status });
    return ok({ projectId: proj.id, projectCode: proj.code, projectName: proj.name, fromStatus: proj.status, toStatus: args.status, dryRun: false });
  }
}

// ===== 2. create_activity =====

export interface CreateActivityArgs {
  projectCodeOrName: string;
  title: string;
  /** 计划日 YYYY-MM-DD（可省） */
  planDate?: string;
  /** 客户主负责人姓名（可省） */
  clientContactName?: string;
  /** 活动内容（可省） */
  content?: string;
  dryRun?: boolean;
}

export interface CreateActivityResult {
  readonly activityId: string;
  readonly projectId: string;
  readonly title: string;
  readonly planDate?: string;
  readonly clientContactName?: string;
  readonly dryRun: boolean;
}

export interface CreateActivityToolDeps {
  businessModuleService: BusinessModuleService;
  projectRepo: ResolveProjectArgs["projectRepo"];
  logger: Logger;
}

export class CreateActivityTool implements Tool<CreateActivityArgs, CreateActivityResult> {
  readonly name = "create_activity";
  readonly description =
    "在指定项目的『项目推进活动计划』里新增一条活动。" +
    "必填 title（活动名称），可选 planDate（YYYY-MM-DD）/ clientContactName / content。" +
    "活动状态默认『计划中』，可后续用 update_activity_status 切换为『已完成 / 已搁置』。" +
    "传 dryRun=true 时不实际创建，仅返会生成的活动 id 占位。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "title"],
    properties: {
      projectCodeOrName: { type: "string", description: "项目编号或名称" },
      title: { type: "string", description: "活动名称", minLength: 1, maxLength: 200 },
      planDate: { type: "string", description: "计划日期 YYYY-MM-DD" },
      clientContactName: { type: "string", description: "客户主负责人姓名（可省）" },
      content: { type: "string", description: "活动内容（可省）" },
      dryRun: { type: "boolean", default: false },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: CreateActivityToolDeps) {}

  async execute(args: CreateActivityArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<CreateActivityResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    if (!args.title.trim()) return fail("title is required");
    if (args.dryRun) {
      return ok({
        activityId: "(dry-run)",
        projectId: proj.id,
        title: args.title.trim(),
        ...(args.planDate ? { planDate: args.planDate } : {}),
        ...(args.clientContactName ? { clientContactName: args.clientContactName } : {}),
        dryRun: true,
      });
    }
    const payload: { planDate?: string; clientContactName?: string } = {};
    if (args.planDate) payload.planDate = args.planDate;
    if (args.clientContactName) payload.clientContactName = args.clientContactName;
    const r = await this.deps.businessModuleService.createItem(proj.id, "activity", {
      title: args.title.trim(),
      content: args.content ?? "",
      payloadJson: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined,
    });
    if (!r.ok) return fail(r.error.message);
    this.deps.logger.info("create_activity", { projectId: proj.id, activityId: r.value.id });
    return ok({
      activityId: r.value.id,
      projectId: proj.id,
      title: r.value.title,
      ...(args.planDate ? { planDate: args.planDate } : {}),
      ...(args.clientContactName ? { clientContactName: args.clientContactName } : {}),
      dryRun: false,
    });
  }
}

// ===== 3. create_function_list_item =====

export interface CreateFunctionListItemArgs {
  projectCodeOrName: string;
  category: string;
  module: string;
  name: string;
  /** CP = Case Point 数（0/1/3/5/8/13/20）；0 = 未设 */
  cp?: number;
  /** 是否在项目范围内；默认 true */
  inScope?: boolean;
  dryRun?: boolean;
}

export interface CreateFunctionListItemResult {
  readonly itemId: string;
  readonly projectId: string;
  readonly category: string;
  readonly module: string;
  readonly name: string;
  readonly cp: number;
  readonly inScope: boolean;
  readonly dryRun: boolean;
}

export interface CreateFunctionListItemToolDeps {
  businessModuleService: BusinessModuleService;
  projectRepo: ResolveProjectArgs["projectRepo"];
  logger: Logger;
}

const ALLOWED_CP = [0, 1, 3, 5, 8, 13, 20] as const;

export class CreateFunctionListItemTool implements Tool<CreateFunctionListItemArgs, CreateFunctionListItemResult> {
  readonly name = "create_function_list_item";
  readonly description =
    "在指定项目的『功能清单』里新增一条功能项。必填 category/module/name 三级，" +
    "可选 cp（建议值 0/1/3/5/8/13/20，0 表示暂未设）与 inScope（默认 true）。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "category", "module", "name"],
    properties: {
      projectCodeOrName: { type: "string", description: "项目编号或名称" },
      category: { type: "string", description: "分类（订单 / 支付 / 库存…）", minLength: 1 },
      module: { type: "string", description: "模块（如下单 / 退款…）", minLength: 1 },
      name: { type: "string", description: "功能名（如『提交订单』）", minLength: 1 },
      cp: { type: "integer", enum: [0, 1, 3, 5, 8, 13, 20], default: 0 },
      inScope: { type: "boolean", default: true },
      dryRun: { type: "boolean", default: false },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: CreateFunctionListItemToolDeps) {}

  async execute(args: CreateFunctionListItemArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<CreateFunctionListItemResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    if (!args.category.trim() || !args.module.trim() || !args.name.trim()) {
      return fail("category / module / name must all be non-empty");
    }
    const cp = args.cp ?? 0;
    if (!ALLOWED_CP.includes(cp as typeof ALLOWED_CP[number])) {
      return fail(`cp must be one of ${ALLOWED_CP.join("/")}, got ${cp}`);
    }
    const inScope = args.inScope ?? true;
    if (args.dryRun) {
      return ok({ itemId: "(dry-run)", projectId: proj.id, category: args.category, module: args.module, name: args.name, cp, inScope, dryRun: true });
    }
    // 后端需要非空 title（CreateItemInput 校验）；拼一个
    const composedTitle = `${args.category} / ${args.module} / ${args.name}`;
    const r = await this.deps.businessModuleService.createItem(proj.id, "function_list", {
      title: composedTitle,
      content: "",
      payloadJson: JSON.stringify({
        category: args.category,
        module: args.module,
        name: args.name,
        cp,
        inScope,
      }),
    });
    if (!r.ok) return fail(r.error.message);
    this.deps.logger.info("create_function_list_item", { projectId: proj.id, itemId: r.value.id });
    return ok({ itemId: r.value.id, projectId: proj.id, category: args.category, module: args.module, name: args.name, cp, inScope, dryRun: false });
  }
}

// ===== 4. update_markdown_module =====

const ALLOWED_MARKDOWN_KINDS: readonly BusinessModuleKind[] = [
  "markdown_business_current",
  "markdown_pain_point",
  "markdown_improvement",
  "markdown_proposal",
  "markdown_non_functional",
  "markdown_it_environment",
  "markdown_risk",
  "markdown_to_be",
  "markdown_roi",
  "markdown_precondition",
  "markdown_hardware_cost",
];

export interface UpdateMarkdownModuleArgs {
  projectCodeOrName: string;
  /** 11 个 markdown_* kind 之一 */
  kind: BusinessModuleKind;
  /** 完整 markdown 正文（覆盖式） */
  content: string;
  /** 模块标题（覆盖式；缺省沿用 kind 对应的默认标题） */
  title?: string;
  dryRun?: boolean;
}

export interface UpdateMarkdownModuleResult {
  readonly itemId: string;
  readonly projectId: string;
  readonly kind: BusinessModuleKind;
  readonly title: string;
  readonly contentLength: number;
  readonly dryRun: boolean;
}

export interface UpdateMarkdownModuleToolDeps {
  businessModuleService: BusinessModuleService;
  projectRepo: ResolveProjectArgs["projectRepo"];
  logger: Logger;
}

export class UpdateMarkdownModuleTool implements Tool<UpdateMarkdownModuleArgs, UpdateMarkdownModuleResult> {
  readonly name = "update_markdown_module";
  readonly description =
    "写入/覆盖某个项目的某个 markdown 模块的正文。" +
    "kind 取值：business_current / pain_point / improvement / proposal / " +
    "non_functional / it_environment / risk / to_be / roi / precondition / hardware_cost。" +
    "调用示例：write『构想方案』可传 kind=proposal, content=完整 Markdown 正文。" +
    "默认采用覆盖式（不追加）；调用方若想保留原内容需先 read_markdown_module 读取再合并。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "kind", "content"],
    properties: {
      projectCodeOrName: { type: "string" },
      kind: { type: "string", enum: ALLOWED_MARKDOWN_KINDS as unknown as string[] },
      content: { type: "string", description: "完整 Markdown 正文" },
      title: { type: "string" },
      dryRun: { type: "boolean", default: false },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: UpdateMarkdownModuleToolDeps) {}

  async execute(args: UpdateMarkdownModuleArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<UpdateMarkdownModuleResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    if (!ALLOWED_MARKDOWN_KINDS.includes(args.kind)) {
      return fail(`kind must be a markdown_* kind, got ${args.kind}`);
    }
    // 找现有 item；不存在则 create，否则 update（getOrInit 风格的简化）
    const existingList = await this.deps.businessModuleService.listItems(proj.id, args.kind);
    const existing = existingList[0];
    if (args.dryRun) {
      return ok({
        itemId: existing?.id ?? "(dry-run)",
        projectId: proj.id,
        kind: args.kind,
        title: args.title ?? existing?.title ?? "",
        contentLength: args.content.length,
        dryRun: true,
      });
    }
    if (existing) {
      const r = await this.deps.businessModuleService.updateItem(existing.id, {
        content: args.content,
        ...(args.title ? { title: args.title } : {}),
      });
      if (!r.ok) return fail(r.error.message);
      this.deps.logger.info("update_markdown_module", { projectId: proj.id, kind: args.kind, itemId: r.value.id });
      return ok({ itemId: r.value.id, projectId: proj.id, kind: args.kind, title: r.value.title, contentLength: args.content.length, dryRun: false });
    }
    const defaultTitle = args.title ?? "";
    if (!defaultTitle) return fail("title is required when creating a new module");
    const r = await this.deps.businessModuleService.createItem(proj.id, args.kind, {
      title: defaultTitle,
      content: args.content,
    });
    if (!r.ok) return fail(r.error.message);
    this.deps.logger.info("update_markdown_module (new)", { projectId: proj.id, kind: args.kind, itemId: r.value.id });
    return ok({ itemId: r.value.id, projectId: proj.id, kind: args.kind, title: r.value.title, contentLength: args.content.length, dryRun: false });
  }
}

// ===== 5. save_questionnaire_outline =====

export interface SaveQuestionnaireOutlineArgs {
  projectCodeOrName: string;
  /** 脑图根节点（text + 嵌套 children） */
  root: {
    text: string;
    children: Array<{
      text: string;
      children: Array<{
        text: string;
        children: unknown[];
      }>;
    }>;
  };
  dryRun?: boolean;
}

export interface SaveQuestionnaireOutlineResult {
  readonly outlineId: string;
  readonly projectId: string;
  readonly nodeCount: number;
  readonly dryRun: boolean;
}

export interface SaveQuestionnaireOutlineToolDeps {
  surveyQuestionnaireUseCase: SurveyQuestionnaireUseCase;
  projectRepo: ResolveProjectArgs["projectRepo"];
  logger: Logger;
}

export class SaveQuestionnaireOutlineTool implements Tool<SaveQuestionnaireOutlineArgs, SaveQuestionnaireOutlineResult> {
  readonly name = "save_questionnaire_outline";
  readonly description =
    "保存指定项目的调查问卷脑图大纲。结构：根 → 分类（category）→ 问题（question）。" +
    "调用示例：传入整棵脑图，会覆盖当前大纲；children 必须是已展开的数组（不是嵌套引用）。" +
    "传 dryRun=true 时不实际保存。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "root"],
    properties: {
      projectCodeOrName: { type: "string" },
      root: {
        type: "object",
        required: ["text", "children"],
        properties: {
          text: { type: "string", description: "根节点文本（通常固定为\"调查主题\"）" },
          children: { type: "array", description: "二级 children 数组（通常每个代表一个分类）" },
        },
      },
      dryRun: { type: "boolean", default: false },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: SaveQuestionnaireOutlineToolDeps) {}

  async execute(args: SaveQuestionnaireOutlineArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<SaveQuestionnaireOutlineResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    const nodeCount = 1 + countAllDescendants(args.root);
    if (args.dryRun) {
      return ok({ outlineId: "(dry-run)", projectId: proj.id, nodeCount, dryRun: true });
    }
    const r = await this.deps.surveyQuestionnaireUseCase.saveOutline(proj.id, args.root as never);
    if (!r.ok) return fail(r.error.message);
    this.deps.logger.info("save_questionnaire_outline", { projectId: proj.id, outlineId: r.value.id, nodeCount });
    return ok({ outlineId: r.value.id, projectId: proj.id, nodeCount, dryRun: false });
  }
}

function countAllDescendants(node: { children?: unknown[] }): number {
  let n = 0;
  const arr = (node.children ?? []) as Array<{ children?: unknown[] }>;
  for (const c of arr) {
    n += 1 + countAllDescendants(c);
  }
  return n;
}

// ===== 6. set_primary_contact =====

export interface SetPrimaryContactArgs {
  projectCodeOrName: string;
  /** 联系人姓名（必须已存在） */
  contactName: string;
  dryRun?: boolean;
}

export interface SetPrimaryContactResult {
  readonly contactId: string;
  readonly projectId: string;
  readonly name: string;
  readonly isPrimary: true;
  readonly dryRun: boolean;
}

export interface SetPrimaryContactToolDeps {
  contactsRepo: IProjectContactsRepository;
  projectRepo: ResolveProjectArgs["projectRepo"];
  clock: Clock;
  logger: Logger;
}

export class SetPrimaryContactTool implements Tool<SetPrimaryContactArgs, SetPrimaryContactResult> {
  readonly name = "set_primary_contact";
  readonly description =
    "把指定项目的某个联系人标记为主联系人（一个项目只能有一个主联系人）。" +
    "按 contactName 匹配；已存在主联系人会被自动取消。" +
    "传 dryRun=true 时不实际修改。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "contactName"],
    properties: {
      projectCodeOrName: { type: "string" },
      contactName: { type: "string", description: "联系人姓名（精确匹配）" },
      dryRun: { type: "boolean", default: false },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: SetPrimaryContactToolDeps) {}

  async execute(args: SetPrimaryContactArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<SetPrimaryContactResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    const contacts = await this.deps.contactsRepo.listByProject(proj.id);
    const target = contacts.find((c) => c.name === args.contactName);
    if (!target) return fail(`contact not found in project ${proj.code}: ${args.contactName}`);
    if (target.isPrimary) {
      return fail(`contact ${args.contactName} is already the primary contact`);
    }
    if (args.dryRun) {
      return ok({ contactId: target.id, projectId: proj.id, name: target.name, isPrimary: true, dryRun: true });
    }
    const r = await this.deps.contactsRepo.update(target.id, { isPrimary: true }, this.deps.clock.now());
    if (!r.ok) return fail(r.error.message);
    this.deps.logger.info("set_primary_contact", { projectId: proj.id, contactId: target.id, name: target.name });
    return ok({ contactId: target.id, projectId: proj.id, name: target.name, isPrimary: true, dryRun: false });
  }
}

// ===== 7. create_survey_task =====

export interface CreateSurveyTaskArgs {
  projectCodeOrName: string;
  title: string;
  /** 主题提示（可省） */
  topicHint?: string;
  /** 详细调查内容（可省） */
  content?: string;
  dryRun?: boolean;
}

export interface CreateSurveyTaskResult {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly topicHint?: string;
  readonly dryRun: boolean;
}

export interface CreateSurveyTaskToolDeps {
  surveyTaskUseCase: SurveyTaskUseCase;
  projectRepo: ResolveProjectArgs["projectRepo"];
  logger: Logger;
}

export class CreateSurveyTaskTool implements Tool<CreateSurveyTaskArgs, CreateSurveyTaskResult> {
  readonly name = "create_survey_task";
  readonly description =
    "在指定项目里新增一条调查任务。任务创建后默认状态『待执行』，可后续调 start_survey_task 执行、" +
    "或用 stop_survey_task 终止。必填 title，可选 topicHint（主题提示）/ content（详细调查内容）。";
  readonly inputSchema = {
    type: "object",
    required: ["projectCodeOrName", "title"],
    properties: {
      projectCodeOrName: { type: "string" },
      title: { type: "string", minLength: 1, maxLength: 200 },
      topicHint: { type: "string", description: "主题提示（如『客户背景信息』）" },
      content: { type: "string", description: "详细调查内容（要 AI 调查的要点）" },
      dryRun: { type: "boolean", default: false },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = true;
  readonly sideEffect = "write" as const;

  constructor(private readonly deps: CreateSurveyTaskToolDeps) {}

  async execute(args: CreateSurveyTaskArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<CreateSurveyTaskResult>> {
    const proj = await resolveProjectId(args.projectCodeOrName, this.deps);
    if (!proj) return fail(`project not found: ${args.projectCodeOrName}`);
    if (!args.title.trim()) return fail("title is required");
    if (args.dryRun) {
      return ok({
        taskId: "(dry-run)",
        projectId: proj.id,
        title: args.title.trim(),
        ...(args.topicHint ? { topicHint: args.topicHint } : {}),
        dryRun: true,
      });
    }
    const r = await this.deps.surveyTaskUseCase.create(
      proj.id,
      args.title.trim(),
      args.content ?? "",
      args.topicHint ? { topicHint: args.topicHint } : undefined,
    );
    if (!r.ok) return fail(r.error.message);
    this.deps.logger.info("create_survey_task", { projectId: proj.id, taskId: r.value.id });
    return ok({
      taskId: r.value.id,
      projectId: proj.id,
      title: r.value.title,
      ...(args.topicHint ? { topicHint: args.topicHint } : {}),
      dryRun: false,
    });
  }
}

// ===== 注册入口 =====

export interface WriteableToolsDeps {
  projectService: ProjectService;
  businessModuleService: BusinessModuleService;
  surveyQuestionnaireUseCase: SurveyQuestionnaireUseCase;
  surveyTaskUseCase: SurveyTaskUseCase;
  contactsRepo: IProjectContactsRepository;
  projectRepo: ResolveProjectArgs["projectRepo"];
  clock: Clock;
  logger: Logger;
}

/**
 * 构造 7 个写工具的实例列表（不自动注册，由调用方 register）。
 * 接受一个共享 deps，每个工具持有同一份。
 */
export function buildWriteableTools(deps: WriteableToolsDeps): import("../tool.ts").Tool[] {
  return [
    new WriteProjectStatusTool({
      projectService: deps.projectService,
      projectRepo: deps.projectRepo,
      logger: deps.logger,
    }),
    new CreateActivityTool({
      businessModuleService: deps.businessModuleService,
      projectRepo: deps.projectRepo,
      logger: deps.logger,
    }),
    new CreateFunctionListItemTool({
      businessModuleService: deps.businessModuleService,
      projectRepo: deps.projectRepo,
      logger: deps.logger,
    }),
    new UpdateMarkdownModuleTool({
      businessModuleService: deps.businessModuleService,
      projectRepo: deps.projectRepo,
      logger: deps.logger,
    }),
    new SaveQuestionnaireOutlineTool({
      surveyQuestionnaireUseCase: deps.surveyQuestionnaireUseCase,
      projectRepo: deps.projectRepo,
      logger: deps.logger,
    }),
    new SetPrimaryContactTool({
      contactsRepo: deps.contactsRepo,
      projectRepo: deps.projectRepo,
      clock: deps.clock,
      logger: deps.logger,
    }),
    new CreateSurveyTaskTool({
      surveyTaskUseCase: deps.surveyTaskUseCase,
      projectRepo: deps.projectRepo,
      logger: deps.logger,
    }),
  ];
}
