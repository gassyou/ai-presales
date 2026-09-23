/**
 * BusinessModuleKind —— 业务模块种类枚举
 *
 * 阶段 7.0：把 20 个业务模块统一抽象为一个 `business_module_items` 表。
 *
 *   - `markdown_*` 系列：业务现状/痛点/改善/构想/非功能/IT 环境/风险/TO-BE/前提/硬件成本 等纯文本模块
 *   - `survey_task`：调查任务（有 AI 异步执行 + 结果报告）
 *   - `survey_questionnaire`：调查问卷（脑图 + 列表，结构化）
 *   - `activity`：项目推进活动计划（列表 + 状态 + 实施情况记录，结构化）
 *   - `use_case`：核心系统用例（编号 + 列表 + 详情编辑）
 *   - `function_list`：功能分析（CP 值 + 工时金额计算 + 三视图）
 *   - `budget_settings`：成本计算设置（每项目单例 + 10 数字参数）
 *   - budget_summary 不在 enum 中：纯派生视图，按 GET /budget-summary 即时计算，不存库
 *   - `deliverable`：交付物一览
 *   - `review`：方案 Review 评估
 *   - `ppt`：提案 PPT 设计
 *   - `custom`：自定义页面
 *   - `hardware_items`：硬件设备成本清单（结构化，每行一类硬件，报价单派生源）
 *
 * 本阶段 7.0 仅实现 `activity` + `markdown_*` 的"通用骨架"；其余模块在后续阶段扩展。
 */

export type BusinessModuleKind =
  // ---- 结构化模块（独立 schema/UI） ----
  | "activity"
  | "survey_task"
  | "survey_questionnaire"
  | "use_case"
  | "function_list"
  | "budget_settings"
  | "deliverable"
  | "review"
  | "ppt"
  | "custom"
  | "hardware_items"               // 阶段 7.4f：硬件设备成本清单（结构化）
  // ---- Markdown 模块（统一走 markdown 内容） ----
  | "markdown_business_current"      // 业务现状
  | "markdown_pain_point"            // 现状问题点/痛点
  | "markdown_improvement"           // 改善目标
  | "markdown_proposal"              // 构想方案
  | "markdown_non_functional"        // 非功能
  | "markdown_it_environment"        // IT/技术环境
  | "markdown_risk"                  // 风险
  | "markdown_to_be"                 // TO-BE
  | "markdown_roi"                   // ROI
  | "markdown_precondition"          // 案件前提条件
  | "markdown_hardware_cost";        // 硬件设备成本

/** 是否属于"纯 markdown 内容"形态（共用一套 UI） */
export function isMarkdownKind(kind: BusinessModuleKind): boolean {
  return kind.startsWith("markdown_");
}
