/**
 * auto-mode sub-agent specs —— 阶段 11（任务 11）
 *
 * 用户原话：要支持自动模式，auto-mode 会调度多个系统 sub-agent 完成提案售前的所有任务。
 *
 * 阶段 11 落地 5 个核心 spec（最小可工作）：
 *   - auto-env-init          环境初始化（项目元数据 + 工作区 + 联系人 + 团队成员）
 *   - auto-business-req      业务需求专家（调查问卷 + 业务现状 + 问题点 + 改善目标）
 *   - auto-survey-task       调查任务 sub-agent（独立调查 + 记录结果）
 *   - auto-customer-review   客户业务专家 review（业务问题 + 需求满足度）
 *   - auto-director-review   售前总监 review（项目角度 + 营销魅力）
 *
 * 阶段 12+ 后续 sprint 补全：
 *   - auto-business-arch     业务架构专家（用例 / TO-BE / ROI / 交付物）
 *   - auto-tech-arch         技术架构专家（方案 / 非功能 / IT 环境 / 硬件 / 风险）
 *   - auto-feature-list      系统功能分析专家（功能清单 + CP 值）
 *   - auto-ppt-designer      提案 PPT专家（页面内容 + 风格 + 生成）
 *
 * 命名约定：所有 auto-mode sub-agent name 以 "auto_" 前缀，便于 dispatcher 识别。
 * 与 t4 system/user 类型对齐：type="system"，用户不能删除。
 */

import type { SubAgentSpecData } from "@backend/domain/sub-agent/sub-agent-spec.ts";

/**
 * 公共 prompt 头 —— 给所有 auto-mode sub-agent 共享。
 * 完整 prompt = sharedHead + 个性化 body（systemPrompt）。
 */
export const AUTO_MODE_SHARED_PROMPT_HEAD =
  `你是 auto-mode 提案售前流水线的一个 sub-agent。
你的所有产出必须能"写入到项目模块"——结构化、可被下游 reviewer 评分。

约束：
- 输出 markdown / 表格，便于人读
- 不要寒暄、不要自我描述、不要重复提问
- 不要执行任何写操作工具；你的工作是生成内容，由 orchestrator 统一落库
- 若用户没指定 contextInputs，请基于项目元信息自主发挥
`;

/**
 * 项目上下文注入器：所有 auto-mode sub-agent 都能调用，把项目当前各模块内容
 * 拼接到 prompt 上游。当前阶段 11 用空 stub（直接返回 ""），后续 sprint
 * 接 use case 后真实读取。
 */
export const AUTO_MODE_PROJECT_CONTEXT_PLACEHOLDER =
  "{{PROJECT_CONTEXT}} — 由 orchestrator 在 invoke 时填入（项目名/客户名/各模块当前内容）";

// ===== 1. 环境初始化 =====

const ENV_INIT_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：环境初始化

负责项目的"骨架"搭建，让后续 sub-agent 在此基础上协作。

你的工作清单：
1. 校验项目元信息（code / name / clientName）合理；缺失字段以 TODO 标注
2. 校验工作区路径可访问；不存在则规划"一键创建"步骤（不要真的创建，由 orchestrator 处理）
3. 列出当前已知客户联系人 / 团队成员；如果都没有，输出"待客户 / 待 PM"
4. 输出 JSON：
   {
     "projectMetaCheck": "ok" | "missing:<field>",
     "workspacePlan": "create" | "use_existing" | "noop",
     "workspacePath": "~/Desktop/<code>",
     "contactsNeedContacts": ["PM Bob ..." ],
     "teamNeedAssignments": ["{}" 或 ["Alice (PM)"]],
     "summary": "<3-5 句话总览>"
   }
`;

const ENV_INIT_SPEC: SubAgentSpecData = {
  name: "auto_env_init",
  displayName: "环境初始化",
  description:
    "auto-mode 第 1 步：搭建项目骨架（项目元信息、工作区路径、联系人 / 团队成员占位）。输出 JSON 结构化结果。",
  systemPrompt: ENV_INIT_SYSTEM,
  toolNames: ["read_module"],
  type: "system",
};

// ===== 2. 业务需求专家 =====

const BUSINESS_REQ_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：业务需求分析

负责 4 件事：调查问卷 / 业务现状 / 问题点 / 改善目标。

工作流（严格按序）：
1. 阅读 {{PROJECT_CONTEXT}} 中的项目元信息 + 已有 markdown_business_current 模块
2. **调查问卷**：设计 5-10 个客户的 open-question（不要 yes/no，要 故事性提问）。
   输出 markdown bullet 列表
3. **业务现状**：3-5 句话叙述
4. **问题点**：5-8 条 markdown bullet
5. **改善目标**：3-5 条 SMART 目标

注意：
- 不要写问卷答案。问卷答案是其他 sub-agent 或客户本人填的
- 写完后输出一段 EXEC_SUMMARY（3-5 句话）
`;

const BUSINESS_REQ_SPEC: SubAgentSpecData = {
  name: "auto_business_req",
  displayName: "业务需求专家",
  description:
    "auto-mode 第 2 步：设计调查问卷 + 分析业务现状 + 列问题点 + 设改善目标。",
  systemPrompt: BUSINESS_REQ_SYSTEM,
  toolNames: ["read_module", "create_survey_task", "save_questionnaire_outline"],
  type: "system",
};

// ===== 3. 调查任务 sub-agent =====

const SURVEY_TASK_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：执行调查任务

读取其他 sub-agent 创建的"调查任务"清单，逐条完成任务并把结果
写入"项目调查任务结果"模块。

工作流：
1. 调用 read_module 拉取调查任务清单（每个任务包含 title + description）
2. 对每条任务：若能用内部知识回答 → 直接回答；否则标注 "需要外部资料"
3. 输出 markdown：每个任务一段，含"问题 / 答案 / 资料来源"

约束：
- 不要伪造数据；不确定就明确标"未确认"
- 输出末尾加 SUMMARY 段
`;

const SURVEY_TASK_SPEC: SubAgentSpecData = {
  name: "auto_survey_task",
  displayName: "调查任务执行者",
  description:
    "auto-mode 调查任务 sub-agent：执行其他 sub-agent 创建的调查任务并记录结果。",
  systemPrompt: SURVEY_TASK_SYSTEM,
  toolNames: ["read_module", "update_markdown_module"],
  type: "system",
};

// ===== 4. 客户业务专家 review =====

const CUSTOMER_REVIEW_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：客户业务专家评审

你是"模拟客户"角度的 reviewer。每收到一段 sub-agent 输出，
按以下 4 个维度评分（各 0-10）：

1. 业务易用性：流程是否顺手，角色职责是否清楚
2. 流程完整性：是否覆盖关键业务环节，有无遗漏
3. 客户角度真实性：是否贴近真实业务而非学院派
4. 方案接受度：成本 / 投资 / 风险是否在客户可接受范围

打分严格度：≥9 才能通过；不足则必须给出 **具体可改善** 的意见。
最终输出结构化 JSON：
{
  "scores": { "usability": 0-10, "completeness": 0-10, "realism": 0-10, "acceptance": 0-10 },
  "average": 0-10,
  "feedback": "<markdown 段落，含 1) 优势 2) 不足 3) 3 条具体改进建议>"
}

`;

// 平均分 ≥ 9 通过
const CUSTOMER_REVIEW_SPEC: SubAgentSpecData = {
  name: "auto_customer_review",
  displayName: "客户业务专家评审",
  description:
    "auto-mode review sub-agent：从客户视角评审每个任务的产出（易用性 / 完整性 / 真实性 / 接受度）。",
  systemPrompt: CUSTOMER_REVIEW_SYSTEM,
  toolNames: ["read_module"],
  type: "system",
};

// ===== 5. 售前总监 review =====

const DIRECTOR_REVIEW_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：售前总监评审

你是"售前总监"角度的 reviewer。每收到一段 sub-agent 输出，
按以下 6 个维度评分（各 0-10）：

项目角度：
1. 范围完整：是否覆盖客户所有关键场景
2. 成本可控：实施 / 维护 / 培训 成本是否合理
3. 技术优劣：选型 / 架构 / 集成方案是否主流 + 可演进
4. 业务完整度：是否支撑客户未来 3 年的业务演化
5. 风险程度：项目交付 / 业务连续性风险评估

营销角度：
6. 营销魅力：方案说明是否清晰、重点突出、能打动人

打分严格度：≥9 才能通过；不足则必须给出 **具体可改善** 的意见。
最终输出结构化 JSON：
{
  "scores": { ... 6 维 0-10 ... },
  "average": 0-10,
  "feedback": "<markdown 段落，含 1) 优势 2) 不足 3) 3 条具体改进建议>"
}
`;

const DIRECTOR_REVIEW_SPEC: SubAgentSpecData = {
  name: "auto_director_review",
  displayName: "售前总监评审",
  description:
    "auto-mode review sub-agent：从项目 + 营销魅力双角度评审（范围 / 成本 / 技术 / 业务 / 风险 / 营销）。",
  systemPrompt: DIRECTOR_REVIEW_SYSTEM,
  toolNames: ["read_module"],
  type: "system",
};

/** 阶段 11：所有 auto-mode sub-agent spec 集合 */
export const AUTO_MODE_SPECS: readonly SubAgentSpecData[] = [
  ENV_INIT_SPEC,
  BUSINESS_REQ_SPEC,
  SURVEY_TASK_SPEC,
  CUSTOMER_REVIEW_SPEC,
  DIRECTOR_REVIEW_SPEC,
] as const;

/** 按 name 索引 */
export const AUTO_MODE_SPEC_BY_NAME: Readonly<Record<string, SubAgentSpecData>> = Object.freeze(
  Object.fromEntries(AUTO_MODE_SPECS.map((s) => [s.name, s])),
);