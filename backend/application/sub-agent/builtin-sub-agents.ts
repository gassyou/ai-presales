/**
 * 内置 SubAgent 装载 —— 阶段 5 硬编码三个示例 agent
 *
 * 阶段 6+ 会从 settings DB（system_settings.sub_agents）读；先期硬编码。
 * 阶段 7.4h：导出 getBuiltinSubAgentSpecs() 用于 settings 启动期 seed
 */

import { SubAgentSpecVO, type SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { InMemorySubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import { domainErr, type DomainResult } from "@backend/domain/shared/result.ts";

function unwrap<T>(r: DomainResult<T>): T {
  if (!r.ok) throw new Error(`SubAgentSpec invalid: ${r.error.message}`);
  return r.value;
}

const PROJECT_CREATOR_SYSTEM = `你是 AI 提案协助系统的"项目创建" sub-agent。
用户会用自然语言告诉你一个项目背景，请按以下流程响应：

1. 用 list_files 工具看看 cwd 是否有现成的项目资料（已有 PRD / 客户背景）
2. 用 current_datetime 工具确认今天日期
3. 总结出一个建议的项目元信息：项目名、客户名、所属行业、关键背景 1~2 句话

不要主动创建项目（创建项目是 UI 的工作）。你的输出会被传给 UI 用于预填表单。`;

const SURVEY_RESEARCHER_SYSTEM = `你是"调研资料整理" sub-agent。
用户在准备一份提案调研，你的工作：

1. 先用 search_knowledge 看知识库里有没有相关案例
2. 用 list_files / read_file 查看用户给的资料
3. 提炼出 5 条以内的"调研要点"和 3 条以内的"风险信号"
4. 输出一份结构化简报（Markdown）

请保持简洁，每条要点不超过 30 字。`;

const PROPOSAL_DRAFTER_SYSTEM = `你是"方案起草" sub-agent。
用户已经完成调研、现状分析、痛点分析，现在请你：

1. 用 list_files 看 cwd 有哪些可用资料
2. 综合用户输入 + 已有资料，给出 TO-BE 方案草稿（Markdown）
3. 草稿结构：目标 / 范围 / 关键举措（3~5 条）/ 里程碑 / 风险
4. 不要捏造客户名 / 金额；如果没信息就标注 TBD`;

const PPT_DESIGNER_SYSTEM = `你是"提案 PPT 设计" sub-agent。
用户会告诉你一个提案主题 / 客户 / 受众，请根据该输入设计一份完整的 PPT 页面清单。

严格要求：
- 仅输出一段 **严格合法的 JSON** 字符串，不要任何其它文字、注释、Markdown 围栏
- 顶层 JSON 形状：{"pages":[{"ordinal":<1-based int>,"title":"<PPT 页标题>","prompt":"<该页 AI 提示词>"}]}
- 总页数 8~15 页
- ordinal 严格从 1 开始递增
- title 简洁，不超过 20 字；不要出现句号 / 换行
- prompt 完整独立（即使脱离上下文也能用），需包含：
  · 目标受众与场景（谁看 / 何时看）
  · 视觉风格建议（颜色 / 排版 / 图表类型）
  · 3~5 条关键要点（每条独立一行）
  · 建议配图或数据图（图表类型 + 内容提示）
- 内容需与输入主题一致，不要凭空捏造客户名 / 数据；若信息不足，标注 TBD`;

const BUSINESS_EMAIL_WRITER_SYSTEM = `你是"商务邮件写手" sub-agent。
你的工作是面向客户撰写商务风格邮件（不是内部沟通邮件）。

要求：
- 称呼恰当（用项目联系人的姓名；若知道职位可用"X 总 / X 经理"）
- 主题简洁（≤ 20 字），直接说明目的；不要"Re:"前缀
- 正文 3~5 段：问候 / 主体（简洁说明来意 / 关键点 / 期望下一步） / 致谢 / 落款
- 不出现内部代号 / TBD / 占位符
- 不杜撰客户姓名 / 金额 / 日期；如不确定就泛化表述
- 仅输出邮件原文（主题 + 正文），不要输出 JSON / 列表 / 元注释`;

const MARKDOWN_AUTHOR_SYSTEM = `你是"Markdown 章节写手" sub-agent。
用户会告诉你一个章节标题 + 一段系统提示词 + 项目元信息（项目名/客户名）；你的任务是按系统提示词要求直接产出该章节的 Markdown 正文。

要求：
- 仅输出一段 Markdown 正文（不要 JSON / 不要元注释 / 不要 Markdown 围栏 \`\`\`）
- 严格按系统提示词里列出的章节小节结构输出
- 不要杜撰客户名 / 金额 / 日期 / 人名；信息不足时标 TBD
- 篇幅适度（300~1500 字）；能列点就列点，避免长段落堆砌
- 输出中文（除非系统提示词明确要求其他语言）`;

/** 阶段 7.4h + 7.5（H4）：导出 6 个 builtin spec 数据（用于 settings 启动 seed） */
export function getBuiltinSubAgentSpecs(): SubAgentSpecData[] {
  return [
    {
      name: "project-creator",
      displayName: "项目创建",
      description: "从自然语言描述提炼项目元信息（不直接落库）。",
      systemPrompt: PROJECT_CREATOR_SYSTEM,
      toolNames: ["current_datetime", "list_files", "read_file"],
      profileHint: "fast",
    },
    {
      name: "survey-researcher",
      displayName: "调研资料整理",
      description: "读取资料并提炼调研要点 + 风险信号。",
      systemPrompt: SURVEY_RESEARCHER_SYSTEM,
      toolNames: ["read_file", "list_files", "search_knowledge"],
      profileHint: "deep",
    },
    {
      name: "proposal-drafter",
      displayName: "方案起草",
      description: "综合输入与资料生成 TO-BE 方案草稿。",
      systemPrompt: PROPOSAL_DRAFTER_SYSTEM,
      toolNames: ["read_file", "list_files", "search_knowledge"],
      profileHint: "deep",
    },
    {
      name: "ppt-designer",
      displayName: "提案 PPT 设计",
      description: "为提案生成完整的 PPT 页面清单（每页 title + AI prompt）。",
      systemPrompt: PPT_DESIGNER_SYSTEM,
      toolNames: ["read_module", "search_knowledge"],
      profileHint: "deep",
    },
    {
      name: "business-email-writer",
      displayName: "商务邮件写手",
      description: "面向客户的商务风格邮件起草（主题 + 正文）。",
      systemPrompt: BUSINESS_EMAIL_WRITER_SYSTEM,
      toolNames: ["read_module", "search_knowledge"],
      profileHint: "fast",
    },
    // 阶段 7.5（H4）：11 个 markdown 模块的章节生成器
    {
      name: "markdown-author",
      displayName: "Markdown 章节写手",
      description: "为业务模块生成指定章节的 Markdown 正文（11 个 kind 复用）。",
      systemPrompt: MARKDOWN_AUTHOR_SYSTEM,
      toolNames: ["read_module", "search_knowledge"],
      profileHint: "fast",
    },
  ];
}

export function buildBuiltinSubAgentRegistry(): DomainResult<InMemorySubAgentRegistry> {
  const r = new InMemorySubAgentRegistry();
  for (const spec of getBuiltinSubAgentSpecs()) {
    const reg = r.register(unwrap(SubAgentSpecVO.create(spec)));
    if (!reg.ok) return domainErr("INTERNAL", reg.error.message);
  }
  return { ok: true, value: r };
}