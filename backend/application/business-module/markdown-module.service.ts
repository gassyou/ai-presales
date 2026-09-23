/**
 * MarkdownModuleService —— markdown_* 业务模块的统一用例
 *
 * 阶段 7.3。11 个 markdown 模块（业务现状/痛点/改善/构想/非功能/IT 环境/风险/TO-BE/ROI/前提/硬件成本）
 * 共用：
 *   - 每 kind 项目下通常 1 条（getOrInit）
 *   - content 字段存 markdown 正文
 *   - 默认 status=adopted（7.0 已实现）
 *   - AI 生成：阶段 7.5（H4）真调 sub-agent，未注入时退化为模板占位
 *   - 用户可以手动编辑并保存
 *
 * 设计：
 *   - 复用 BusinessModuleService 做 CRUD
 *   - getOrInit(kind)：无则创建空模板（占位 markdown）
 *   - generateContent(kind)：基于项目元数据 + 子代理 prompt 真生成（阶段 7.5/H4）
 */

import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import type { BusinessModuleService } from "./business-module.service.ts";
import type {
  BusinessModuleItemSnapshot,
} from "@backend/domain/business-module/business-module-item.ts";
import { isMarkdownKind, type BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";

const KIND_TO_TITLE: Record<string, string> = {
  markdown_business_current: "业务现状",
  markdown_pain_point: "现状问题点 / 痛点",
  markdown_improvement: "改善目标",
  markdown_proposal: "构想方案",
  markdown_non_functional: "非功能需求",
  markdown_it_environment: "IT/技术环境",
  markdown_risk: "风险分析",
  markdown_to_be: "TO-BE 蓝图",
  markdown_roi: "ROI 分析",
  markdown_precondition: "案件前提条件",
  markdown_hardware_cost: "硬件设备成本",
};

export function moduleTitle(kind: BusinessModuleKind): string {
  return KIND_TO_TITLE[kind] ?? kind;
}

const KIND_TO_TEMPLATE: Record<string, string> = {
  markdown_business_current: `# 业务现状

## 组织架构
（待补充：客户组织架构、汇报关系、决策链）

## 当前业务流程
（待补充：核心业务流程图 / 关键节点）

## 现有系统
（待补充：现有 IT 系统清单）

## 主要痛点概要
（待补充：用户当前遇到的主要问题）

> AI 生成时，会基于项目已知信息（项目简介/客户简介）填充以上小节。
`,
  markdown_pain_point: `# 现状问题点 / 痛点

## 业务痛点
- 痛点 1：…
- 痛点 2：…

## 系统痛点
- 系统痛点 1：…

## 影响范围
- 受影响用户 / 部门：…
- 业务影响：…

> 后续可在 AI 对话框中基于调查任务结果进一步完善。
`,
  markdown_improvement: `# 改善目标

## 业务目标
- 目标 1：…
- 目标 2：…

## 度量指标（KPI）
- 指标 1：基线 → 目标
- 指标 2：…

## 时间窗口
- 短期（3 个月）：…
- 中期（6-12 个月）：…

`,
  markdown_proposal: `# 构想方案

## 整体思路
…

## 关键模块
### 模块 1
- 业务价值
- 关键能力

### 模块 2
…

## 实施路径
1. 第一阶段：…
2. 第二阶段：…

`,
  markdown_non_functional: `# 非功能需求

## 性能
- 响应时间：…
- 吞吐量：…
- 并发用户：…

## 可用性
- SLA：99.x %
- 容灾：…

## 安全性
- 等保级别：…
- 数据分类：…

## 可维护性 / 可扩展性
…

`,
  markdown_it_environment: `# IT/技术环境

## 基础设施
- 服务器：…
- 网络：…

## 中间件
- 数据库：…
- 消息队列：…

## 集成系统
- 系统 A：…

`,
  markdown_risk: `# 风险分析

| 风险 | 类别 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|----------|
| …   | …   | 高/中/低 | 高/中/低 | … |

## 风险等级判定
- 高风险：…
- 中风险：…
- 低风险：…

`,
  markdown_to_be: `# TO-BE 蓝图

## 目标态业务流程
…

## 数据架构
…

## 应用架构
…

## 演进路线
1. 阶段 1：…
2. 阶段 2：…

`,
  markdown_roi: `# ROI 分析

## 投入
- 软件投入：…
- 硬件投入：…
- 实施服务投入：…

## 收益
- 直接收益：…
- 间接收益：…

## 回收期
- 静态回收期：…
- 动态回收期：…

## 五年累计 ROI
…

`,
  markdown_precondition: `# 案件前提条件

## 客户侧前提
- 组织条件：…
- 资源条件：…

## 我方前提
- 人力投入：…
- 交付承诺：…

## 商务前提
- 付款条件：…
- 知识产权：…

`,
  markdown_hardware_cost: `# 硬件设备成本

| 类别 | 设备 | 数量 | 单价 | 小计 |
|------|------|------|------|------|
| 服务器 | … | … | … | … |
| 网络 | … | … | … | … |
| 存储 | … | … | … | … |
| 终端 | … | … | … | … |

## 合计
- 硬件小计：…
- 含税合计：…

`,
};

/**
 * 阶段 7.5（H4）：11 个 markdown kind → 各自 system prompt 提示词
 * 让 sub-agent 知道要为哪个章节写什么。
 */
const KIND_TO_SYSTEM_PROMPT: Record<string, string> = {
  markdown_business_current: "请基于以下项目背景信息撰写「业务现状」章节 markdown。要求覆盖组织架构、当前业务流程、现有 IT 系统、主要痛点概要 4 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_pain_point: "请基于以下项目背景信息撰写「现状问题点 / 痛点」章节 markdown。要求覆盖业务痛点、系统痛点、影响范围（受影响用户/部门、业务影响）3 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_improvement: "请基于以下项目背景信息撰写「改善目标」章节 markdown。要求覆盖业务目标、KPI 度量指标、时间窗口（短期/中期）3 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_proposal: "请基于以下项目背景信息撰写「构想方案」章节 markdown。要求覆盖整体思路、关键模块（2~3 个，每个含业务价值/关键能力）、实施路径 3 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_non_functional: "请基于以下项目背景信息撰写「非功能需求」章节 markdown。要求覆盖性能（响应时间/吞吐量/并发用户）、可用性（SLA/容灾）、安全性（等保级别/数据分类）、可维护性/可扩展性 4 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_it_environment: "请基于以下项目背景信息撰写「IT/技术环境」章节 markdown。要求覆盖基础设施（服务器/网络）、中间件（数据库/消息队列）、集成系统 3 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_risk: "请基于以下项目背景信息撰写「风险分析」章节 markdown。要求覆盖风险表（风险/类别/概率/影响/缓解措施 5 列）、风险等级判定（高/中/低风险分列）2 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_to_be: "请基于以下项目背景信息撰写「TO-BE 蓝图」章节 markdown。要求覆盖目标态业务流程、数据架构、应用架构、演进路线（分阶段）4 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_roi: "请基于以下项目背景信息撰写「ROI 分析」章节 markdown。要求覆盖投入（软件/硬件/实施服务）、收益（直接/间接）、回收期（静态/动态）、五年累计 ROI 4 节；不要杜撰金额；信息不足时标注 TBD。",
  markdown_precondition: "请基于以下项目背景信息撰写「案件前提条件」章节 markdown。要求覆盖客户侧前提（组织/资源）、我方前提（人力投入/交付承诺）、商务前提（付款条件/知识产权）3 节；不要杜撰客户名 / 金额；信息不足时标注 TBD。",
  markdown_hardware_cost: "请基于以下项目背景信息撰写「硬件设备成本」章节 markdown。要求覆盖硬件清单表（类别/设备/数量/单价/小计 5 列；服务器/网络/存储/终端至少 3 类）、合计（硬件小计/含税合计）2 节；不要杜撰金额；信息不足时标注 TBD。",
};

/**
 * 阶段 7.5（H4）：11 个 markdown kind → 派发给哪个 sub-agent。
 * 业务现状/痛点 → survey-researcher（与现有调研链路一致）
 * 方案/TO-BE → proposal-drafter（方案起草链路）
 * 其余 7 项 → 新 markdown-author（通用 markdown 章节生成）
 */
const KIND_TO_SUBAGENT: Record<string, string> = {
  markdown_business_current: "survey-researcher",
  markdown_pain_point: "survey-researcher",
  markdown_improvement: "markdown-author",
  markdown_proposal: "proposal-drafter",
  markdown_non_functional: "markdown-author",
  markdown_it_environment: "markdown-author",
  markdown_risk: "markdown-author",
  markdown_to_be: "proposal-drafter",
  markdown_roi: "markdown-author",
  markdown_precondition: "markdown-author",
  markdown_hardware_cost: "markdown-author",
};

/** 阶段 7.5（H4）：可选注入 sub-agent 调用闭包；未注入时退化为模板占位 */
export type InvokeSubAgentFn = (
  subAgentName: string,
  userInput: string,
  opts?: { signal?: AbortSignal },
) => AsyncIterable<StreamEvent>;

export interface MarkdownModuleResult {
  id: string;
  projectId: string;
  kind: BusinessModuleKind;
  title: string;
  content: string;
  status: "pending" | "adopted" | "unadopted";
  createdAt: string;
  updatedAt: string;
}

export interface MarkdownModuleServiceDeps {
  businessModuleService: BusinessModuleService;
  clock?: Clock;
  /** 阶段 7.5（H4）：注入后真调 LLM；未注入走模板占位 fallback（向后兼容 dev/测试） */
  invokeSubAgent?: InvokeSubAgentFn;
  /** 阶段 7.5（H4）：可选提供项目元信息（项目名/客户名）以便 prompt 注入上下文 */
  getProjectMeta?: (projectId: ProjectId) => Promise<{ name: string; clientName: string } | null>;
}

export class MarkdownModuleService {
  private readonly bm: BusinessModuleService;
  private readonly clock: Clock;
  /** 阶段 7.5（H4）：可选 sub-agent 调用闭包 */
  private readonly invokeSubAgent: InvokeSubAgentFn | undefined;
  /** 阶段 7.5（H4）：可选项目元信息拉取函数 */
  private readonly getProjectMeta: ((projectId: ProjectId) => Promise<{ name: string; clientName: string } | null>) | undefined;

  constructor(deps: MarkdownModuleServiceDeps) {
    this.bm = deps.businessModuleService;
    this.clock = deps.clock ?? new SystemClock();
    this.invokeSubAgent = deps.invokeSubAgent;
    this.getProjectMeta = deps.getProjectMeta;
  }

  async getOrInit(projectId: ProjectId, kind: BusinessModuleKind): Promise<DomainResult<MarkdownModuleResult>> {
    if (!isMarkdownKind(kind)) {
      return domainErr("INVALID_INPUT", `kind ${kind} is not a markdown module`);
    }
    const items = await this.bm.listItems(projectId, kind);
    const existing = items[0];
    if (existing) return domainOk(snapshotToResult(existing));
    const title = moduleTitle(kind);
    const template = KIND_TO_TEMPLATE[kind] ?? `# ${title}\n\n（开始编辑）\n`;
    const r = await this.bm.createItem(projectId, kind, {
      title,
      content: template,
    });
    if (!r.ok) return r;
    return domainOk(snapshotToResult(r.value));
  }

  async get(projectId: ProjectId, kind: BusinessModuleKind): Promise<DomainResult<MarkdownModuleResult | null>> {
    if (!isMarkdownKind(kind)) {
      return domainErr("INVALID_INPUT", `kind ${kind} is not a markdown module`);
    }
    const items = await this.bm.listItems(projectId, kind);
    const existing = items[0];
    if (!existing) return domainOk(null);
    return domainOk(snapshotToResult(existing));
  }

  async saveContent(itemId: string, content: string): Promise<DomainResult<MarkdownModuleResult>> {
    const r = await this.bm.updateItem(itemId, { content });
    if (!r.ok) return r;
    return domainOk(snapshotToResult(r.value));
  }

  /**
   * AI 生成（阶段 7.5/H4 重构）：
   *   - invokeSubAgent 已注入 → 按 KIND_TO_SUBAGENT 派发到对应 sub-agent → 用 collectStreamToString 抽干流
   *   - 未注入 → 沿用模板 fallback（dev/测试不破）
   *
   * 失败时降级到模板（不抛错，保证 UI 不阻塞）
   */
  async generateContent(projectId: ProjectId, kind: BusinessModuleKind): Promise<DomainResult<MarkdownModuleResult>> {
    const cur = await this.getOrInit(projectId, kind);
    if (!cur.ok) return cur;

    let content: string;
    if (this.invokeSubAgent) {
      const subAgent = KIND_TO_SUBAGENT[kind] ?? "markdown-author";
      const systemPrompt = KIND_TO_SYSTEM_PROMPT[kind] ?? `请撰写「${moduleTitle(kind)}」章节 markdown。`;
      const projectMeta = await this.safeGetProjectMeta(projectId);
      const ctx = projectMeta ? `项目名：${projectMeta.name}\n客户：${projectMeta.clientName}\n` : "";
      const userInput = `${systemPrompt}\n\n${ctx}\n请基于上述背景直接输出 markdown 正文，不要输出 JSON / 元注释 / Markdown 围栏。`;
      try {
        content = await collectStreamToString(this.invokeSubAgent(subAgent, userInput));
      } catch (e) {
        // 失败降级到模板（不阻塞）
        content = this.fallbackContent(kind) + `\n\n> AI 生成失败：${e instanceof Error ? e.message : String(e)}\n`;
      }
      if (!content.trim()) content = this.fallbackContent(kind);
    } else {
      // 旧模板占位路径（dev/测试 fallback）
      content = this.fallbackContent(kind);
    }
    const stamped = content + `\n\n> 生成时间：${this.clock.now().toISOString()}\n`;
    const r = await this.bm.updateItem(cur.value.id, { content: stamped });
    if (!r.ok) return r;
    return domainOk(snapshotToResult(r.value));
  }

  /** 阶段 7.5（H4）：内部辅助 — 拉项目元信息（拿不到不抛错，prompt 退化） */
  private async safeGetProjectMeta(projectId: ProjectId): Promise<{ name: string; clientName: string } | null> {
    if (!this.getProjectMeta) return null;
    try {
      return await this.getProjectMeta(projectId);
    } catch {
      return null;
    }
  }

  /** 阶段 7.5（H4）：内部辅助 — 模板 fallback 内容 */
  private fallbackContent(kind: BusinessModuleKind): string {
    return KIND_TO_TEMPLATE[kind] ?? `# ${moduleTitle(kind)}\n\n（开始编辑）\n`;
  }

  async setAdoption(itemId: string, adopted: boolean): Promise<DomainResult<MarkdownModuleResult>> {
    const r = adopted ? await this.bm.adopt(itemId) : await this.bm.unadopt(itemId);
    if (!r.ok) return r;
    return domainOk(snapshotToResult(r.value));
  }
}

function snapshotToResult(snap: BusinessModuleItemSnapshot): MarkdownModuleResult {
  return {
    id: snap.id,
    projectId: snap.projectId,
    kind: snap.kind as BusinessModuleKind,
    title: snap.title,
    content: snap.content,
    status: snap.status,
    createdAt: snap.createdAt.toISOString(),
    updatedAt: snap.updatedAt.toISOString(),
  };
}
