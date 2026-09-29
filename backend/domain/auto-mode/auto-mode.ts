/**
 * AutoMode —— 阶段 11（任务 11）：auto-mode 多 agent 编排领域模型
 *
 * 用户原话：要支持自动模式，该模式会创建并调度多个系统sub-agent完成提案售前的所有任务，
 *           不需要用户中途参与。这些sub-agent团队包括：
 *           - 主agent负责调度和各项任务进度确认
 *           - 环境初始化sub-agent：项目元数据 + 工作区 + 客户联系人 / 团队成员
 *           - 客户业务专家sub-agent：从客户角度 review 成果 / 业务问题 / 业务背景调查
 *           - 售前总监sub-agent：review 每任务成果（项目 + 营销魅力）
 *           - 调查任务 sub-agent：执行其他 sub-agent 创建的调查任务
 *           - 业务需求专家 sub-agent：调查问卷 / 业务现状 / 问题点 / 改善目标
 *           - 业务架构专家 sub-agent：核心用例 / TO-BE / ROI / 交付物
 *           - 技术架构专家 sub-agent：方案设计 / 非功能需求 / IT 环境 / 硬件 / 风险
 *           - 系统功能分析专家 sub-agent：功能清单 + CP 值
 *           - 提案 PPT专家 sub-agent：每页内容 + 风格 + 生成 PPT
 *
 * 每个任务完成 → 客户业务专家 + 售前总监 双 review；
 * 平均分 ≥ 9/10 才算通过；否则继续 round（≤3 轮）。
 *
 * 阶段 11 设计原则：
 *   - 骨架优先：定义类型 + orchestrator 接口 + 评估协议；具体 sub-agent 拆为后续 sprint
 *   - 阶段 11 必交付：
 *       TaskPlan, TaskSpec, ReviewScore, TaskResult, TaskRunnerResult
 *       AutoModeOrchestrator 抽象接口 + 最小可工作的实现
 *       3 个系统 sub-agent spec（环境初始化 / 调查任务 / 业务需求专家）
 *       2 个 review sub-agent spec（客户业务 / 售前总监）
 *   - 留 TODO stub：技术架构 / 业务架构 / 系统功能 / 提案PPT 各留空壳 spec
 */

import type { ProjectId } from "@shared/types/ids.ts";

/**
 * TaskPlan —— auto-mode 的"工作分解结构"
 *
 * 一个 Plan = 一组有序的子任务，每个子任务对应一个 sub-agent 的执行；
 * 主 agent 负责调度。任务有依赖（DAG 拓扑），当前 runner 用简化版：
 *   - 按 tasks 顺序串行执行（依赖靠"顺序"表达）
 *   - 每个任务跑完后跑 review（双 review）
 *   - review 不通过 → 重跑当前任务（最多 reviewRoundLimit 轮）
 */
export interface TaskPlan {
  readonly projectId: ProjectId;
  /** 全局唯一 plan id（用于持久化 + 状态回溯） */
  readonly id: string;
  /** 任务列表（顺序 = 执行顺序） */
  readonly tasks: readonly TaskSpec[];
}

/** sub-agent 名作为映射 */
export type SubAgentName = string;

/**
 * TaskSpec —— 一次"任务" = 一个 sub-agent 的执行单元
 */
export interface TaskSpec {
  /** 任务名（plan 内唯一） */
  readonly name: string;
  /** 调用的 sub-agent 名 */
  readonly subAgentName: SubAgentName;
  /** 用户附加说明（写入 sub-agent 的 prompt） */
  readonly description: string;
  /**
   * 阶段 11：可选的"输入路径"列表。每个路径 = 一个项目模块 kind
   * （如 "markdown_business_current"），sub-agent 启动前会自动把项目对应模块的内容
   * 注入到 prompt。用于"上下文感知"。
   * 留 [] 表示不需要前置上下文（首个任务往往是环境初始化）。
   */
  readonly contextInputs: readonly ContextInputKind[];
}

/**
 * 上下文输入类型 —— 标识要从哪个项目模块读取内容
 * 与现有 markdown_* / use_case / 等模块对齐（subset）
 */
export type ContextInputKind =
  | "project_meta"
  | "markdown_business_current"
  | "markdown_pain_point"
  | "markdown_improvement"
  | "use_case"
  | "deliverable"
  | "questionnaire_outline"
  | "survey_task_results"
  | "function_list";

/**
 * ReviewScore —— 单次 review 的打分
 *
 * 两个 reviewer 各给 0-10 分；任务整体通过当 (average >= 9) 且总轮数 <= reviewRoundLimit。
 */
export interface ReviewScore {
  /** 子任务名（对应 TaskSpec.name） */
  readonly taskName: string;
  /** 第几轮 review（从 1 开始） */
  readonly round: number;
  /** 客户业务专家打分 0-10 */
  readonly customerScore: number;
  /** 售前总监打分 0-10 */
  readonly directorScore: number;
  /** 平均分 */
  readonly average: number;
  /** 客户业务专家书面意见（给 worker 下轮改善） */
  readonly customerFeedback: string;
  /** 售前总监书面意见 */
  readonly directorFeedback: string;
  /** 是否通过（average >= 9） */
  readonly passed: boolean;
}

/**
 * 阶段 11：reviewer 配置
 */
export const REVIEW_PASS_THRESHOLD = 9;
export const DEFAULT_REVIEW_ROUND_LIMIT = 3;

/**
 * TaskResult —— 单个 sub-agent 一次执行的产物
 */
export interface TaskResult {
  readonly taskName: string;
  readonly subAgentName: SubAgentName;
  /** sub-agent 的最终输出（markdown / 表格 / 结构化摘要） */
  readonly output: string;
  /** 写入项目的模块（领域落库）；可选 */
  readonly wroteModules: readonly ContextInputKind[];
  /** 评分历史（含所有轮） */
  readonly reviews: readonly ReviewScore[];
  /** 最终是否通过 */
  readonly passed: boolean;
  /** 用了多少轮 review（>= 1） */
  readonly rounds: number;
}

/**
 * AutoModeResult —— 整个 plan 的执行结果
 */
export interface AutoModeResult {
  readonly planId: string;
  readonly projectId: ProjectId;
  readonly taskResults: readonly TaskResult[];
  readonly success: boolean;
  /** 全部任务通过的总耗时 ms */
  readonly totalMs: number;
}

/**
 * AutoModeOrchestrator —— 阶段 11 的核心接口
 *
 * 调用方（HTTP route / 未来的 cron / UI auto-mode 按钮）传入一个 plan，
 * orchestrator 按顺序执行每个任务、收集 review、不通过时重跑、最终汇总结果。
 *
 * 注入两个 reviewer（customerReviewer / directorReviewer）是函数
 * —— 让编排器本身不直接依赖具体 LLM/agent 实现，测试可用假实现。
 */
export interface Reviewer {
  readonly role: "customer" | "director";
  readonly name: string;
  /**
   * 对 task output 评分（0-10）+ 书面意见。
   * 真实实现：调 sub-agent 评审 prompt；
   * 测试实现：返回固定分数。
   */
  review(args: {
    readonly projectId: ProjectId;
    readonly task: TaskSpec;
    readonly previousReviews: readonly ReviewScore[];
    readonly taskOutput: string;
  }): Promise<{ score: number; feedback: string }>;
}

/**
 * Worker —— 执行任务（调 sub-agent）
 * 也抽象为接口，便于测试用 fake worker 注入。
 */
export interface AutoModeWorker {
  /**
   * 执行 task，返回输出 markdown + 写入的模块列表。
   * @param feedback 上轮 review 的反馈（第一轮为空）；worker 应据此改善
   */
  executeTask(args: {
    readonly projectId: ProjectId;
    readonly task: TaskSpec;
    readonly context: Readonly<Partial<Record<ContextInputKind, string>>>;
    readonly feedback: readonly string[];
    readonly round: number;
  }): Promise<{ output: string; wroteModules: readonly ContextInputKind[] }>;
}

/**
 * ContextProvider —— 给 worker / reviewer 提供项目各模块的内容
 * 真实实现调 use case；测试用 in-memory fake。
 *
 * 用 Partial<Record<...>>：调用方不必填所有 kind；缺失的 key 在 worker 端
 * 视为"该模块暂无内容"。
 */
export interface AutoModeContextProvider {
  loadContext(
    projectId: ProjectId,
    kinds: readonly ContextInputKind[],
  ): Promise<Readonly<Partial<Record<ContextInputKind, string>>>>;
}

/**
 * Orchestrator 配置
 */
export interface AutoModeOrchestratorDeps {
  readonly worker: AutoModeWorker;
  readonly customerReviewer: Reviewer;
  readonly directorReviewer: Reviewer;
  readonly contextProvider: AutoModeContextProvider;
  /** 最多 review 重试轮数；默认 3 */
  readonly reviewRoundLimit?: number;
  /** 通过阈值；默认 9 */
  readonly passThreshold?: number;
}

/**
 * 进度回调（用于前端实时显示）
 */
export type AutoModeProgressKind =
  | "task_start"
  | "task_review"
  | "task_pass"
  | "task_fail"
  | "plan_done"
  | "plan_failed";

export interface AutoModeProgressEvent {
  readonly kind: AutoModeProgressKind;
  readonly planId: string;
  readonly taskName?: string;
  readonly round?: number;
  readonly score?: ReviewScore;
  readonly message: string;
  readonly atMs: number;
}

export type AutoModeProgressListener = (ev: AutoModeProgressEvent) => void | Promise<void>;