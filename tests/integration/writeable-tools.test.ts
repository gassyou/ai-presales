/**
 * 写工具（WriteableTools）集成测试 —— 阶段 H
 *
 * 覆盖：
 *   - dryRun=true 不写后端
 *   - dryRun=false 真实写入并返回 id
 *   - 参数校验（必填缺失、status/reason 联动）
 *   - 错误路径（项目不存在、kind 非法、联系人找不到）
 *
 * 每个工具用最小可工作的 service 实例（内存 SQLite）。
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { SqliteProjectContactsRepository } from "@backend/persistence/sqlite/sqlite-project-contacts.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { SurveyTaskUseCase } from "@backend/application/business-module/survey-task.usecase.ts";
import { SurveyQuestionnaireUseCase } from "@backend/application/business-module/survey-questionnaire.usecase.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { createLogger } from "@backend/infrastructure/logging/logger.ts";
import {
  CreateActivityTool,
  CreateFunctionListItemTool,
  CreateSurveyTaskTool,
  SaveQuestionnaireOutlineTool,
  SetPrimaryContactTool,
  UpdateMarkdownModuleTool,
  WriteProjectStatusTool,
  type WriteableToolsDeps,
} from "@backend/ai/tool/builtin/writeable-tools.ts";
import type { ToolContext } from "@backend/ai/tool/tool.ts";

function newDb(): Database {
  return new Database({
    paths: {
      root: "/tmp/whatever",
      data: "/tmp/whatever",
      logs: "/tmp/whatever",
      vendor: "/tmp/whatever",
      output: "/tmp/whatever",
    },
    inMemory: true,
    skipExtensions: true,
  });
}

interface Setup {
  projectService: ProjectService;
  businessModuleService: BusinessModuleService;
  surveyTaskUseCase: SurveyTaskUseCase;
  surveyQuestionnaireUseCase: SurveyQuestionnaireUseCase;
  contactsRepo: SqliteProjectContactsRepository;
  projectRepo: SqliteProjectRepository;
  clock: FixedClock;
  deps: WriteableToolsDeps;
}

async function setup(): Promise<Setup> {
  const db = newDb();
  await db.ready();
  const projectRepo = new SqliteProjectRepository(db);
  const contactsRepo = new SqliteProjectContactsRepository(db);
  const businessRepo = new SqliteBusinessModuleRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const projectService = new ProjectService({ repo: projectRepo, contactsRepo, teamRepo: undefined as never, clock });
  const businessModuleService = new BusinessModuleService({ repo: businessRepo, clock });
  const surveyTaskUseCase = new SurveyTaskUseCase({ businessModuleService: businessModuleService, clock });
  const surveyQuestionnaireUseCase = new SurveyQuestionnaireUseCase({ businessModuleService, clock });

  // 建一个项目（必填 ACME）作为测试目标
  const r = await projectService.createProject({ name: "enrich-test", clientName: "ACME" });
  if (!r.ok) throw new Error("setup: createProject failed");

  const logger = createLogger({ level: "error", sink: () => {} });
  const deps: WriteableToolsDeps = {
    projectService,
    businessModuleService,
    surveyTaskUseCase,
    surveyQuestionnaireUseCase,
    contactsRepo,
    projectRepo,
    clock,
    logger,
  };
  return { projectService, businessModuleService, surveyTaskUseCase, surveyQuestionnaireUseCase, contactsRepo, projectRepo, clock, deps };
}

function fakeCtx(): ToolContext {
  return { logger: createLogger({ level: "error", sink: () => {} }), cwd: "/tmp/x", allowedPaths: [], timeoutMs: 1000 };
}

// ========== WriteProjectStatusTool ==========

Deno.test("write_project_status — dryRun 不写", async () => {
  const { deps } = await setup();
  const tool = new WriteProjectStatusTool({
    projectService: deps.projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", status: "提案中", dryRun: true }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, true);
  assertEquals(r.value.toStatus, "提案中");
});

Deno.test("write_project_status — 真实写入（不带 reason）", async () => {
  const { deps, projectService } = await setup();
  const tool = new WriteProjectStatusTool({
    projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", status: "提案中" }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, false);
  // 验证项目状态确实改了
  const got = await projectService.getProject((r.value.projectId as never));
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.status, "提案中");
});

Deno.test("write_project_status — 中标必须带 bestPractice", async () => {
  const { deps, projectService } = await setup();
  // 先推进到"提案中"
  const toProposal = await projectService.changeProjectStatus(
    (await deps.projectRepo.findByMentionToken("enrich-test"))!.id as never,
    "提案中",
  );
  assert(toProposal.ok);
  const tool = new WriteProjectStatusTool({
    projectService: deps.projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", status: "中标" }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  // 阶段 1：中标必填 bestPractice（不再只是 reason）
  assertStringIncludes(r.error, "bestPractice");
});

Deno.test("write_project_status — 中止必须带 pausedDate + stopReason", async () => {
  const { deps, projectService } = await setup();
  const toProposal = await projectService.changeProjectStatus(
    (await deps.projectRepo.findByMentionToken("enrich-test"))!.id as never,
    "提案中",
  );
  assert(toProposal.ok);
  const tool = new WriteProjectStatusTool({
    projectService: deps.projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  // 缺 pausedDate
  const r1 = await tool.execute(
    { projectCodeOrName: "enrich-test", status: "中止", stopReason: "客户撤回预算" },
    fakeCtx(),
  );
  assert(!r1.ok);
  if (r1.ok) return;
  assertStringIncludes(r1.error, "pausedDate");
  // 缺 stopReason
  const r2 = await tool.execute(
    { projectCodeOrName: "enrich-test", status: "中止", pausedDate: "2026-12-01" },
    fakeCtx(),
  );
  assert(!r2.ok);
  if (r2.ok) return;
  assertStringIncludes(r2.error, "stopReason");
  // 都齐全 → 写入成功
  const r3 = await tool.execute(
    { projectCodeOrName: "enrich-test", status: "中止", pausedDate: "2026-12-01", stopReason: "客户撤回预算" },
    fakeCtx(),
  );
  assert(r3.ok);
  if (!r3.ok) return;
  const got = await projectService.getProject((r3.value.projectId as never));
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.status, "中止");
  assertEquals(got.value.pausedDate?.toISOString(), new Date("2026-12-01").toISOString());
  assertEquals(got.value.pauseReason, "客户撤回预算");
});

Deno.test("write_project_status — 中标带 bestPractice 真实写入", async () => {
  const { deps, projectService } = await setup();
  const proj = (await deps.projectRepo.findByMentionToken("enrich-test"))!;
  await projectService.changeProjectStatus(proj.id as never, "提案中");
  const tool = new WriteProjectStatusTool({
    projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute(
    {
      projectCodeOrName: "enrich-test",
      status: "中标",
      bestPractice: "决策层提前 1 月接触",
    },
    fakeCtx(),
  );
  assert(r.ok);
  if (!r.ok) return;
  const got = await projectService.getProject((r.value.projectId as never));
  assert(got.ok);
  if (!got.ok) return;
  assertEquals(got.value.status, "中标");
  assertEquals(got.value.bestPractice, "决策层提前 1 月接触");
});

Deno.test("write_project_status — 项目不存在", async () => {
  const { deps } = await setup();
  const tool = new WriteProjectStatusTool({
    projectService: deps.projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "nonexistent", status: "提案中" }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  assertStringIncludes(r.error, "project not found");
});

Deno.test("write_project_status — 同状态转换失败", async () => {
  const { deps } = await setup();
  const tool = new WriteProjectStatusTool({
    projectService: deps.projectService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", status: "新建" }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  assertStringIncludes(r.error, "already in status");
});

// ========== CreateActivityTool ==========

Deno.test("create_activity — dryRun 不写", async () => {
  const { deps } = await setup();
  const tool = new CreateActivityTool({
    businessModuleService: deps.businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    title: "拜访客户",
    planDate: "2026-10-01",
    dryRun: true,
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, true);
  assertEquals(r.value.title, "拜访客户");
});

Deno.test("create_activity — 真实写入并出现在项目", async () => {
  const { deps, businessModuleService } = await setup();
  const tool = new CreateActivityTool({
    businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    title: "拜访客户王总",
    planDate: "2026-10-01",
    clientContactName: "王总",
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, false);
  // 验证后端真的有这条 activity
  const proj = r.value.projectId;
  const list = await businessModuleService.listItems(proj as never, "activity");
  assertEquals(list.length, 1);
  assertEquals(list[0]!.title, "拜访客户王总");
});

Deno.test("create_activity — 缺 title 失败", async () => {
  const { deps } = await setup();
  const tool = new CreateActivityTool({
    businessModuleService: deps.businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", title: "" }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  assertStringIncludes(r.error, "title is required");
});

// ========== CreateFunctionListItemTool ==========

Deno.test("create_function_list_item — 真实写入", async () => {
  const { deps, businessModuleService } = await setup();
  const tool = new CreateFunctionListItemTool({
    businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    category: "订单",
    module: "下单",
    name: "提交订单",
    cp: 5,
    inScope: true,
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, false);
  // 验证后端
  const list = await businessModuleService.listItems(r.value.projectId as never, "function_list");
  assertEquals(list.length, 1);
  assertEquals(list[0]!.title, "订单 / 下单 / 提交订单");
});

Deno.test("create_function_list_item — 非法 cp 失败", async () => {
  const { deps } = await setup();
  const tool = new CreateFunctionListItemTool({
    businessModuleService: deps.businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    category: "订单",
    module: "下单",
    name: "x",
    cp: 7,
  }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  assertStringIncludes(r.error, "cp must be");
});

// ========== UpdateMarkdownModuleTool ==========

Deno.test("update_markdown_module — 创建新模块", async () => {
  const { deps, businessModuleService } = await setup();
  const tool = new UpdateMarkdownModuleTool({
    businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    kind: "markdown_business_current",
    title: "业务现状",
    content: "# 业务现状\n\n这是 AI 写入的内容。",
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, false);
  // 验证
  const list = await businessModuleService.listItems(r.value.projectId as never, "markdown_business_current");
  assertEquals(list.length, 1);
  assertEquals(list[0]!.content, "# 业务现状\n\n这是 AI 写入的内容。");
});

Deno.test("update_markdown_module — 覆盖已有模块", async () => {
  const { deps, businessModuleService } = await setup();
  // 先建一个（用真实项目 id）
  const projects = await deps.projectRepo.findByMentionToken("enrich-test");
  assert(projects);
  if (!projects) return;
  const cr = await businessModuleService.createItem(
    projects.id,
    "markdown_proposal",
    { title: "构想方案", content: "v1" },
  );
  assert(cr.ok);
  if (!cr.ok) return;
  // 改写它
  const tool = new UpdateMarkdownModuleTool({
    businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    kind: "markdown_proposal",
    content: "v2 - 新内容",
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  const list = await businessModuleService.listItems(r.value.projectId as never, "markdown_proposal");
  assertEquals(list.length, 1);
  assertEquals(list[0]!.content, "v2 - 新内容");
});

Deno.test("update_markdown_module — 非 markdown kind 失败", async () => {
  const { deps } = await setup();
  const tool = new UpdateMarkdownModuleTool({
    businessModuleService: deps.businessModuleService,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    kind: "activity" as never,
    content: "x",
    title: "x",
  }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  assertStringIncludes(r.error, "must be a markdown_");
});

// ========== SaveQuestionnaireOutlineTool ==========

Deno.test("save_questionnaire_outline — 真实保存脑图", async () => {
  const { deps, surveyQuestionnaireUseCase } = await setup();
  const tool = new SaveQuestionnaireOutlineTool({
    surveyQuestionnaireUseCase,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    root: {
      text: "调查主题",
      children: [
        {
          text: "客户背景",
          children: [
            { text: "组织架构", children: [] },
            { text: "行业地位", children: [] },
          ],
        },
        {
          text: "IT 现状",
          children: [
            { text: "ERP 系统", children: [] },
          ],
        },
      ],
    },
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, false);
  // 节点数 = 1 (root) + 2 (categories) + 3 (questions) = 6
  assertEquals(r.value.nodeCount, 6);
  // 后端确实拿到
  const proj = await deps.projectRepo.findByMentionToken("enrich-test");
  assert(proj);
  if (!proj) return;
  const out = await surveyQuestionnaireUseCase.getOutline(proj.id as never);
  assert(out.ok);
  if (!out.ok) return;
  assertEquals(out.value?.mindmap?.text, "调查主题");
});

Deno.test("save_questionnaire_outline — dryRun 不写", async () => {
  const { deps, surveyQuestionnaireUseCase } = await setup();
  const tool = new SaveQuestionnaireOutlineTool({
    surveyQuestionnaireUseCase,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    root: { text: "X", children: [] },
    dryRun: true,
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, true);
  // 后端没动
  const proj = await deps.projectRepo.findByMentionToken("enrich-test");
  assert(proj);
  if (!proj) return;
  const out = await surveyQuestionnaireUseCase.getOutline(proj.id as never);
  assert(out.ok);
  if (!out.ok) return;
  assertEquals(out.value, null);
});

// ========== SetPrimaryContactTool ==========

Deno.test("set_primary_contact — 设置并清除上一个", async () => {
  const { deps, contactsRepo } = await setup();
  // 先插两个联系人
  const proj = await deps.projectRepo.findByMentionToken("enrich-test");
  assert(proj);
  if (!proj) return;
  await contactsRepo.create({ projectId: proj.id as never, name: "张三", email: "a@x.com", createdAt: deps.clock.now() });
  await contactsRepo.create({ projectId: proj.id as never, name: "李四", email: "b@x.com", createdAt: deps.clock.now() });
  const list0 = await contactsRepo.listByProject(proj.id as never);
  const zhang = list0.find((c) => c.name === "张三");
  assert(zhang);
  if (!zhang) return;
  await contactsRepo.update(zhang.id, { isPrimary: true }, deps.clock.now());
  // 现在把李四设为主联系人
  const tool = new SetPrimaryContactTool({
    contactsRepo,
    projectRepo: deps.projectRepo,
    clock: deps.clock,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", contactName: "李四" }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  // 后端：张三不再是主，李四是主
  const list1 = await contactsRepo.listByProject(proj.id as never);
  const newZhang = list1.find((c) => c.name === "张三");
  const li = list1.find((c) => c.name === "李四");
  assertEquals(newZhang?.isPrimary, false);
  assertEquals(li?.isPrimary, true);
});

Deno.test("set_primary_contact — 联系人找不到", async () => {
  const { deps } = await setup();
  const tool = new SetPrimaryContactTool({
    contactsRepo: deps.contactsRepo,
    projectRepo: deps.projectRepo,
    clock: deps.clock,
    logger: deps.logger,
  });
  const r = await tool.execute({ projectCodeOrName: "enrich-test", contactName: "不存在" }, fakeCtx());
  assert(!r.ok);
  if (r.ok) return;
  assertStringIncludes(r.error, "contact not found");
});

// ========== CreateSurveyTaskTool ==========

Deno.test("create_survey_task — 真实创建", async () => {
  const { deps, surveyTaskUseCase } = await setup();
  const tool = new CreateSurveyTaskTool({
    surveyTaskUseCase,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    title: "客户背景调查",
    topicHint: "客户行业 / 业务",
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.dryRun, false);
  // 后端
  const proj = await deps.projectRepo.findByMentionToken("enrich-test");
  assert(proj);
  if (!proj) return;
  const list = await surveyTaskUseCase.list(proj.id as never);
  assertEquals(list.length, 1);
  assertEquals(list[0]!.title, "客户背景调查");
});

Deno.test("create_survey_task — dryRun 不写", async () => {
  const { deps, surveyTaskUseCase } = await setup();
  const tool = new CreateSurveyTaskTool({
    surveyTaskUseCase,
    projectRepo: deps.projectRepo,
    logger: deps.logger,
  });
  const r = await tool.execute({
    projectCodeOrName: "enrich-test",
    title: "X",
    dryRun: true,
  }, fakeCtx());
  assert(r.ok);
  if (!r.ok) return;
  // 后端没动
  const proj = await deps.projectRepo.findByMentionToken("enrich-test");
  assert(proj);
  if (!proj) return;
  const list = await surveyTaskUseCase.list(proj.id as never);
  assertEquals(list.length, 0);
});

// ========== 装配校验 ==========

Deno.test("buildWriteableTools — 7 个工具注册到 registry", async () => {
  const { deps } = await setup();
  // 动态 import 避免循环依赖
  const { buildWriteableTools } = await import("@backend/ai/tool/builtin/writeable-tools.ts");
  const { ToolRegistry } = await import("@backend/ai/tool/tool-registry.ts");
  const r = new ToolRegistry();
  const tools = buildWriteableTools(deps);
  for (const t of tools) r.register(t);
  // 7 个写工具 + 0 个 builtin（没调 buildBuiltinToolRegistry）
  assertEquals(tools.length, 7);
  assertEquals(r.names().length, 7);
  assert(r.has("write_project_status"));
  assert(r.has("create_activity"));
  assert(r.has("create_function_list_item"));
  assert(r.has("update_markdown_module"));
  assert(r.has("save_questionnaire_outline"));
  assert(r.has("set_primary_contact"));
  assert(r.has("create_survey_task"));
});
