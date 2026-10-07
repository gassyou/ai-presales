/**
 * 内置 SubAgent 装载 —— 阶段 5 硬编码三个示例 agent
 *
 * 阶段 6+ 会从 settings DB（system_settings.sub_agents）读；先期硬编码。
 * 阶段 7.4h：导出 getBuiltinSubAgentSpecs() 用于 settings 启动期 seed
 */

import { SubAgentSpecVO, type SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { InMemorySubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import { AUTO_MODE_SPECS } from "@backend/ai/auto-mode/auto-mode-agents.ts";
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

// 阶段 H：写入型 sub-agent。专做"按自然语言下达命令 → 调写工具落库"。
// 注意：写工具本身要求 projectCodeOrName / contactName / kind / 等强标识；
// 这里提示词教会模型从自然语言里提取这些字段，避免误调错项目。
const PROJECT_EDITOR_SYSTEM = `你是"项目编辑" sub-agent（阶段 H 新增）。
用户会用自然语言告诉你"要做的事"（例如："把 2026-00005 项目的状态改成提案中"、
"给『enrich-test』项目加一条推进活动：明天拜访客户王总"、"把方案构想方案的正文
改成 Markdown 三段：第一段目标，第二段范围，第三段风险"）。

**你必须按以下流程响应**：

1. **先解析项目标识**：用 read_module 或 project 相关的查询工具拿到 projectId / projectCode。
   如果用户给的标识（项目编号 / 项目名称）找不到对应项目，用 fail 风格的回复明确告知。

2. **按用户意图选工具**。可用写工具：
   - write_project_status     —— 修改项目状态（新建/提案中/暂停/中标/未中标；"暂停"是单向流程，没有恢复动作）
   - create_activity          —— 新增项目推进活动
   - create_function_list_item —— 功能清单加一条
   - update_markdown_module   —— 写入 11 个 markdown_* 模块正文
   - save_questionnaire_outline —— 保存调查问卷脑图
   - set_primary_contact      —— 把某个联系人设为主联系人
   - create_survey_task       —— 新增调查任务

3. **dryRun 习惯**：金额 / 标题 / 正文这类用户没明确给但你猜的内容，**先用 dryRun=true
   跑一遍**，把"将要做的事"展示给用户，由用户确认后再用 dryRun=false 执行。
   状态切换、活动创建、联系人操作这类用户意图明确的，直接 dryRun=false。

4. **出错时**：不要重复同一个工具调用。读 Tool 错误信息调整参数或问用户。

5. **不要杜撰**：人名 / 金额 / 日期这类不确定的，先问用户。

只调用写工具；读操作仍走 read_module / search_knowledge。`;

/** 阶段 7.4h + 7.5（H4）+ 阶段 H：导出 7 个 builtin spec 数据（用于 settings 启动 seed） */
/** 阶段 4：builtin sub-agent 全部为 system 类型（用户不可删除/改名） */
export function getBuiltinSubAgentSpecs(): SubAgentSpecData[] {
  // 源数据仍是手写 plain object；包一层 type=system 后导出
  return [
    {
      name: "project-creator",
      displayName: "项目创建",
      description: "从自然语言描述提炼项目元信息（不直接落库）。",
      systemPrompt: PROJECT_CREATOR_SYSTEM,
      toolNames: ["current_datetime", "list_files", "read_file"],
      profileHint: "fast",
      type: "system",
    },
    {
      name: "survey-researcher",
      displayName: "调研资料整理",
      description: "读取资料并提炼调研要点 + 风险信号。",
      systemPrompt: SURVEY_RESEARCHER_SYSTEM,
      toolNames: ["read_file", "list_files", "search_knowledge"],
      profileHint: "deep",
      type: "system",
    },
    {
      name: "proposal-drafter",
      displayName: "方案起草",
      description: "综合输入与资料生成 TO-BE 方案草稿。",
      systemPrompt: PROPOSAL_DRAFTER_SYSTEM,
      toolNames: ["read_file", "list_files", "search_knowledge"],
      profileHint: "deep",
      type: "system",
    },
    {
      name: "ppt-designer",
      displayName: "提案 PPT 设计",
      description: "为提案生成完整的 PPT 页面清单（每页 title + AI prompt）。",
      systemPrompt: PPT_DESIGNER_SYSTEM,
      toolNames: ["read_module", "search_knowledge"],
      profileHint: "deep",
      type: "system",
    },
    {
      name: "business-email-writer",
      displayName: "商务邮件写手",
      description: "面向客户的商务风格邮件起草（主题 + 正文）。",
      systemPrompt: BUSINESS_EMAIL_WRITER_SYSTEM,
      toolNames: ["read_module", "search_knowledge"],
      profileHint: "fast",
      type: "system",
    },
    // 阶段 7.5（H4）：11 个 markdown 模块的章节生成器
    {
      name: "markdown-author",
      displayName: "Markdown 章节写手",
      description: "为业务模块生成指定章节的 Markdown 正文（11 个 kind 复用）。",
      systemPrompt: MARKDOWN_AUTHOR_SYSTEM,
      toolNames: ["read_module", "search_knowledge"],
      profileHint: "fast",
      type: "system",
    },
    // 阶段 H：项目编辑（写入操作）
    {
      name: "project-editor",
      displayName: "项目编辑",
      description: "按自然语言调写工具落库：改项目状态 / 新增活动 / 新增功能 / 写 markdown / 保存问卷脑图 / 设主联系人 / 新增调查任务。",
      systemPrompt: PROJECT_EDITOR_SYSTEM,
      toolNames: [
        "read_module",
        "write_project_status",
        "create_activity",
        "create_function_list_item",
        "update_markdown_module",
        "save_questionnaire_outline",
        "set_primary_contact",
        "create_survey_task",
      ],
      profileHint: "fast",
      type: "system",
    },
    // 阶段 11（任务 11）：auto-mode 5 个系统 sub-agent
    ...AUTO_MODE_SPECS,
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