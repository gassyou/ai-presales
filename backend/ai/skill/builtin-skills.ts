/**
 * builtin-skills.ts —— 阶段 13（PR #5）：3 个内置业务 skill
 *
 * 与 task 7 demo (skill_list_skills / skill_echo) 共存；
 * 这里新增的 3 个 skill 是真业务流：
 *   - skill_status_check：聚合 chat session / project 数量
 *   - skill_summarize_project：读项目 markdown 模块，调 LLM 生成 5 段中文摘要
 *   - skill_draft_email：读 markdown_business_current + 项目元信息，调 LLM 生成邮件草稿
 *
 * 命名约定 `skill_*`；inputSchema 严格 JSON Schema（additionalProperties: false）。
 */

import type { ILLMClient } from "../client/llm-client.ts";
import type { CanonicalMessage, ChatRequest } from "../message/canonical-message.ts";
import type { Skill } from "./skill.ts";
import type { ToolContext } from "../tool/tool.ts";
import { isMarkdownKind } from "@backend/domain/business-module/business-module.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { ProjectService } from "@backend/application/project/project.service.ts";
import type { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import type { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

/** 阶段 13（PR #5）：makeBuiltinSkills 的依赖（DIP 注入） */
export interface BuiltinSkillsDeps {
  readonly llmClient: ILLMClient;
  /** 默认 LLM profile —— skill 内部生成摘要 / 邮件草稿时使用 */
  readonly defaultProfile: ProfileConfig;
  readonly projectService: ProjectService;
  readonly businessModuleService: BusinessModuleService;
  readonly chatSessionUseCase: ChatSessionUseCase;
  readonly logger: Logger;
}

/** 简易的 LLM 调用辅助：单条 user 文本 → assistant 文本。 */
async function llmText(
  client: ILLMClient,
  profile: ProfileConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const messages: CanonicalMessage[] = [{
    role: "user",
    content: [{ type: "text", text: userPrompt }],
  }];
  const req: ChatRequest = {
    systemPrompt,
    messages,
    model: profile.model,
    temperature: profile.temperature,
    maxOutputTokens: profile.maxTokens,
    signal,
  };
  const result = await client.chat(req);
  // 把 content parts 拼成 string（task 7 默认 skill 是 string；这里同样以 string 形式返）
  return result.message.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

/** skill_status_check —— 聚合系统状态计数 */
function makeSkillStatusCheck(deps: BuiltinSkillsDeps): Skill {
  return {
    name: "skill_status_check",
    displayName: "系统状态检查",
    description:
      "聚合当前系统的关键计数：chat session 数、项目数。用于 LLM 在用户问「系统跑得怎么样」时快速给数字。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async (_args, _ctx: ToolContext) => {
      try {
        const sessions = deps.chatSessionUseCase.listAllSessions().length;
        // 用 listProjects(limit=1, offset=0) 只读 total 字段，避免拉全部快照
        const projectList = await deps.projectService.listProjects({ limit: 1, offset: 0 });
        const projects = projectList.total;
        const report = {
          chatSessions: sessions,
          projects,
          generatedAt: new Date().toISOString(),
        };
        return JSON.stringify(report, null, 2);
      } catch (e) {
        deps.logger.warn("skill_status_check failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        return JSON.stringify({
          error: e instanceof Error ? e.message : String(e),
          generatedAt: new Date().toISOString(),
        });
      }
    },
  };
}

/** skill_summarize_project —— 读项目 markdown 模块，调 LLM 生成 5 段中文摘要 */
function makeSkillSummarizeProject(deps: BuiltinSkillsDeps): Skill {
  return {
    name: "skill_summarize_project",
    displayName: "项目摘要",
    description:
      "读取项目所有 markdown 模块（业务现状/痛点/方案/非功能 等），用 LLM 生成 5 段中文摘要（客户背景、核心需求、关键方案、价值、风险）。输入需 projectId。",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: {
          type: "string",
          description: "要摘要的项目 ID。",
        },
      },
      additionalProperties: false,
    },
    execute: async (args, _ctx: ToolContext) => {
      const { projectId } = args as { projectId: string };
      const pid = toProjectId(projectId);
      const projectGet = await deps.projectService.getProject(pid);
      if (!projectGet.ok) {
        return `项目不存在或已删除：${projectId}`;
      }
      const projectName = projectGet.value.name;
      const clientName = projectGet.value.clientName;

      // 收集所有 markdown 模块内容
      const allKinds = [
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
      ] as const;
      const markdownSnippets: string[] = [];
      for (const kind of allKinds) {
        if (!isMarkdownKind(kind)) continue;
        const list = await deps.businessModuleService.listItems(pid, kind);
        for (const it of list) {
          if (typeof it.content === "string" && it.content.trim().length > 0) {
            markdownSnippets.push(`## ${it.title}\n${it.content.slice(0, 1500)}`);
          }
        }
      }
      if (markdownSnippets.length === 0) {
        return `项目「${projectName}」（客户：${clientName}）尚未填写任何 markdown 模块，无法生成摘要。`;
      }

      const systemPrompt = "你是售前项目分析师。基于给定的项目 markdown 模块，输出 5 段中文摘要：" +
        "1) 客户背景；2) 核心需求；3) 关键方案；4) 价值与 ROI；5) 风险与缓解。" +
        "每段 100-200 字。用简体中文，分行清楚。不要输出 markdown 围栏。";
      const userPrompt = `# 项目 ${projectName}（客户：${clientName}）\n\n${
        markdownSnippets.join("\n\n")
      }`;

      try {
        return await llmText(
          deps.llmClient,
          deps.defaultProfile,
          systemPrompt,
          userPrompt,
          _ctx.signal,
        );
      } catch (e) {
        deps.logger.warn("skill_summarize_project LLM failed", {
          projectId,
          error: e instanceof Error ? e.message : String(e),
        });
        return `摘要生成失败：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}

/** skill_draft_email —— 基于 markdown_business_current + 项目元信息生成邮件草稿 */
function makeSkillDraftEmail(deps: BuiltinSkillsDeps): Skill {
  return {
    name: "skill_draft_email",
    displayName: "邮件草稿生成",
    description:
      "读取项目「业务现状」markdown 模块 + 项目元信息（客户/行业/规模），用 LLM 生成一封正式商务邮件草稿（含主题 + 正文 + 签名占位）。输入需 projectId。",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: {
          type: "string",
          description: "要起草邮件的项目 ID。",
        },
        tone: {
          type: "string",
          enum: ["formal", "casual"],
          description: "语气风格（默认 formal）。",
        },
      },
      additionalProperties: false,
    },
    execute: async (args, _ctx: ToolContext) => {
      const { projectId, tone } = args as {
        projectId: string;
        tone?: "formal" | "casual";
      };
      const projectGet = await deps.projectService.getProject(toProjectId(projectId) as ProjectId);
      if (!projectGet.ok) {
        return `项目不存在或已删除：${projectId}`;
      }
      const projectName = projectGet.value.name;
      const clientName = projectGet.value.clientName;
      const clientWebsite = projectGet.value.clientWebsite ?? null;
      const clientWebsiteText = clientWebsite ?? "（未填）";

      // 读 markdown_business_current
      const businessList = await deps.businessModuleService.listItems(
        toProjectId(projectId),
        "markdown_business_current",
      );
      const businessBody = businessList
        .map((it) => it.content)
        .filter((b) => typeof b === "string" && b.trim().length > 0)
        .join("\n\n");

      const effectiveTone = tone ?? "formal";
      const systemPrompt = effectiveTone === "formal"
        ? "你是商务邮件撰写助手。基于项目信息生成正式商务邮件。结构：主题 / 称呼 / 正文（3 段：背景 / 方案概述 / 下一步）/ 签名占位。用简体中文。不要 markdown 围栏。"
        : "你是商务邮件撰写助手。基于项目信息生成轻松但礼貌的商务邮件。结构：主题 / 称呼 / 正文（3 段：背景 / 方案概述 / 下一步）/ 签名占位。用简体中文，不要 markdown 围栏。";
      const userPrompt = [
        `# 邮件任务`,
        ``,
        `- 项目：${projectName}`,
        `- 客户：${clientName}（官网：${clientWebsiteText}）`,
        `- 语气：${effectiveTone === "formal" ? "正式" : "轻松"}`,
        ``,
        `## 业务现状`,
        businessBody || "(没有业务现状 markdown 模块)",
      ].join("\n");

      try {
        return await llmText(
          deps.llmClient,
          deps.defaultProfile,
          systemPrompt,
          userPrompt,
          _ctx.signal,
        );
      } catch (e) {
        deps.logger.warn("skill_draft_email LLM failed", {
          projectId,
          error: e instanceof Error ? e.message : String(e),
        });
        return `邮件草稿生成失败：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}

/** 阶段 13（PR #5）：注册 3 个新 builtin skill（与 task7 demo 的 skill_list_skills / skill_echo 共存） */
export function makeBuiltinSkills(deps: BuiltinSkillsDeps): Skill[] {
  return [
    makeSkillStatusCheck(deps),
    makeSkillSummarizeProject(deps),
    makeSkillDraftEmail(deps),
  ];
}
