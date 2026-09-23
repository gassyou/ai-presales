/**
 * ContextAssembler —— 上下文装配核心
 *
 * 装配顺序：
 *   1. systemPrompt (基础 + sub-agent 模板)
 *   2. 当前项目摘要（如果有 projectId）
 *   3. @引用项目摘要（未入库 → ProjectSnapshotProvider.summary；已入库 → RagProvider.retrieve）
 *   4. 业务模块摘要（按 scoreRelevance 排序的 Top-K，每块限 maxTokens）
 *   5. 对话历史（最近 N 条；超过 budget 走智能摘要压缩）
 *   6. 当前 user input
 *
 * 装配原则：
 *   - 每段都有 token 上限（来自 ContextBudget）
 *   - 超 token 一律 truncateToTokens
 *   - 顺序拼接后总 tokens 不应超过 budget.total + 10% 容差；超出时按"后压前"截断
 *
 * 注意：本类是纯异步函数 + 依赖注入。具体的 project / rag / module 数据由 SnapshotRegistry 提供。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { CanonicalMessage, CanonicalRole } from "../message/canonical-message.ts";
import { calculateBudget, truncateToTokens, type BudgetConfig, type ContextBudget } from "./context-budget.ts";
import { extractMentionTokens } from "./mention-parser.ts";
import {
  type BusinessModuleSnapshotProvider,
  type ContextFragment,
  type RagProvider,
  SnapshotRegistry,
} from "./snapshot-registry.ts";
import type { TokenCounter } from "./token-counter.ts";

export interface AssembledContext {
  readonly systemPrompt: string;
  readonly messages: readonly CanonicalMessage[];
  readonly budgetUsage: {
    readonly total: number;
    readonly used: number;
    readonly pct: number;
    readonly bySection: Record<string, number>;
  };
  readonly sources: readonly { kind: string; projectId?: string; module?: string }[];
}

export interface ContextAssemblerInput {
  readonly baseSystemPrompt: string;
  readonly projectId?: ProjectId;
  readonly userInput: string;
  readonly recentMessages: readonly CanonicalMessage[];
  /** 预算配置 */
  readonly budget: BudgetConfig;
  /** 评估 mention 时限定的项目域（默认全表） */
  readonly projectLookup: (token: string) => Promise<{ projectId: ProjectId; isIndexed: boolean } | null>;
  /** 历史超长时调用的摘要压缩（默认 stub：直接拼接截断） */
  readonly summarizer?: Summarizer;
}

export type Summarizer = (messages: readonly CanonicalMessage[], maxTokens: number) => Promise<string>;

export interface AssembleDeps {
  readonly tokenCounter: TokenCounter;
  readonly registry: SnapshotRegistry;
  readonly config: BudgetConfig;
}

export class ContextAssembler {
  constructor(private deps: AssembleDeps) {}

  /**
   * 阶段 7.4h：部分更新 budget config（settings 改了 LLM profile 后调用）
   */
  setConfig(partial: Partial<BudgetConfig>): void {
    this.deps = { ...this.deps, config: { ...this.deps.config, ...partial } };
  }

  async assemble(input: ContextAssemblerInput): Promise<AssembledContext> {
    const { tokenCounter, registry } = this.deps;
    const budget = calculateBudget(this.deps.config);

    const sections: Record<string, number> = {};
    const sources: Array<{ kind: string; projectId?: string; module?: string }> = [];
    const messages: CanonicalMessage[] = [];

    // 1) system prompt —— 自身 + 当前项目提示
    let sysText = input.baseSystemPrompt;
    if (input.projectId) {
      sysText += `\n\n## 当前项目\n你正在协助处理项目 ${input.projectId}。`;
      sources.push({ kind: "system", projectId: input.projectId });
    }
    const sysCapped = truncateToTokens(sysText, budget.systemPrompt, tokenCounter);
    sections.systemPrompt = tokenCounter.count(sysCapped);

    // 2) @引用项目
    const mentionTokens = extractMentionTokens(input.userInput);
    let mentionSectionText = "";
    if (mentionTokens.length > 0) {
      const seen = new Set<string>();
      const ragFragments: ContextFragment[] = [];
      const snapshotFragments: ContextFragment[] = [];
      for (const token of mentionTokens) {
        if (seen.has(token.toLowerCase())) continue;
        seen.add(token.toLowerCase());
        const lookup = await input.projectLookup(token);
        if (!lookup) continue;  // 找不到降级为字面（mention-parser 已分词）
        const isRag = registry.getRagProvider() !== null;
        if (lookup.isIndexed && isRag) {
          const hits = await registry.getRagProvider()!.retrieve({
            query: input.userInput,
            projectId: lookup.projectId,
            topK: 8,
            minScore: 0.6,
          });
          ragFragments.push(...hits);
        } else {
          const projProvider = registry.getProjectProvider();
          if (projProvider) {
            const frag = await projProvider.summarize({
              projectId: lookup.projectId,
              maxTokens: 200,  // 方案 D：默认 200 token 摘要 + read_module tool 按需
            });
            if (frag) snapshotFragments.push(frag);
          }
        }
      }

      if (ragFragments.length > 0) {
        const text = "## 知识库召回（来自被引用的项目）\n\n" +
          ragFragments.map((f) => `### ${f.title}\n${f.content}`).join("\n\n");
        const capped = truncateToTokens(text, budget.ragHits, tokenCounter);
        mentionSectionText += capped + "\n\n";
        sections.ragHits = tokenCounter.count(capped);
        for (const f of ragFragments) {
          sources.push({ kind: "rag", projectId: f.projectId ?? undefined });
        }
      }
      if (snapshotFragments.length > 0) {
        const text = "## 被引用项目摘要\n\n" +
          snapshotFragments.map((f) => `### ${f.title}\n${f.content}`).join("\n\n");
        const capped = truncateToTokens(text, budget.projectContext, tokenCounter);
        mentionSectionText += capped + "\n\n";
        sections.projectContext = tokenCounter.count(capped);
        for (const f of snapshotFragments) {
          sources.push({ kind: "mention", projectId: f.projectId ?? undefined });
        }
      }
    }

    // 3) 业务模块摘要 —— 按 score 排序取 Top-K
    let moduleSectionText = "";
    if (input.projectId) {
      const scores = await registry.scoreAll({ projectId: input.projectId, userInput: input.userInput });
      const topK = scores.filter((s) => s.score > 0.2).slice(0, 4);
      for (const { module: moduleName, score } of topK) {
        const provider = registry.getModule(moduleName);
        if (!provider) continue;
        const frag = await provider.summarize({
          projectId: input.projectId,
          maxTokens: Math.floor(budget.businessModules / Math.max(1, topK.length)),
        });
        if (frag) {
          moduleSectionText += `### ${moduleName} (relevance=${score.toFixed(2)})\n${frag.content}\n\n`;
          sources.push({ kind: "module", module: moduleName, projectId: input.projectId });
        }
      }
      if (moduleSectionText) {
        moduleSectionText = "## 相关业务模块\n\n" +
          truncateToTokens(moduleSectionText, budget.businessModules, tokenCounter);
        sections.businessModules = tokenCounter.count(moduleSectionText);
      }
    }

    // 4) 对话历史 —— 智能截断 / 摘要
    const history = await this.assembleHistory(input.recentMessages, budget, input.summarizer);
    sections.conversationHistory = history.tokensUsed;
    messages.push(...history.messages);

    // 5) 当前 user input
    const userMsg: CanonicalMessage = {
      role: "user",
      content: [{ type: "text", text: input.userInput }],
    };
    messages.push(userMsg);
    sections.userInput = tokenCounter.count(input.userInput);

    // 拼装 systemPrompt（基础 + 当前项目 + mention + 模块）
    const fullSystemPrompt = [sysCapped, mentionSectionText, moduleSectionText].filter(Boolean).join("\n\n");
    const sysTokens = tokenCounter.count(fullSystemPrompt);

    // 占比检查
    const totalUsed = sysTokens + history.tokensUsed + sections.userInput;
    const totalBudget = budget.total;
    if (totalUsed > totalBudget * 1.1) {
      // 超预算 10%：压缩历史
      const compressed = await this.compressHistory(
        input.recentMessages,
        Math.max(0, totalBudget - sysTokens - sections.userInput),
        input.summarizer,
      );
      messages.length = 0;
      messages.push(...compressed.messages);
      sections.conversationHistory = compressed.tokensUsed;
    }

    return {
      systemPrompt: fullSystemPrompt,
      messages,
      budgetUsage: {
        total: totalBudget,
        used: totalUsed,
        pct: totalBudget > 0 ? totalUsed / totalBudget : 0,
        bySection: sections,
      },
      sources,
    };
  }

  private async assembleHistory(
    recent: readonly CanonicalMessage[],
    budget: ContextBudget,
    summarizer?: Summarizer,
  ): Promise<{ messages: readonly CanonicalMessage[]; tokensUsed: number }> {
    const { tokenCounter } = this.deps;
    if (recent.length === 0) return { messages: [], tokensUsed: 0 };
    const totalTokens = tokenCounter.countMessages(recent.map((m) => ({ content: this.messageText(m) })));
    if (totalTokens <= budget.conversationHistory) {
      return { messages: recent, tokensUsed: totalTokens };
    }
    // 超长：先取最后 N 条直到预算内
    const out: CanonicalMessage[] = [];
    let used = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      const t = tokenCounter.count(this.messageText(msg)) + 2;
      if (used + t > budget.conversationHistory) break;
      out.unshift(msg);
      used += t;
    }
    if (out.length === recent.length) return { messages: out, tokensUsed: used };
    // 还有更早的消息被丢弃 → 摘要压缩成一段 system prompt
    const dropped = recent.slice(0, recent.length - out.length);
    let summary: string;
    if (summarizer) {
      summary = await summarizer(dropped, Math.floor(budget.conversationHistory * 0.2));
    } else {
      summary = `(省略了 ${dropped.length} 条更早对话)`;
    }
    const summaryMsg: CanonicalMessage = {
      role: "system",
      content: [{ type: "text", text: `## 对话历史摘要\n${summary}` }],
    };
    return {
      messages: [summaryMsg, ...out],
      tokensUsed: used + tokenCounter.count(summary) + 2,
    };
  }

  private async compressHistory(
    recent: readonly CanonicalMessage[],
    targetTokens: number,
    summarizer?: Summarizer,
  ): Promise<{ messages: readonly CanonicalMessage[]; tokensUsed: number }> {
    const { tokenCounter } = this.deps;
    if (recent.length === 0) return { messages: [], tokensUsed: 0 };
    let summary: string;
    if (summarizer) {
      summary = await summarizer(recent, Math.max(1, targetTokens));
    } else {
      summary = `(已压缩 ${recent.length} 条历史)`;
    }
    return {
      messages: [{
        role: "system",
        content: [{ type: "text", text: `## 对话历史摘要\n${summary}` }],
      }],
      tokensUsed: tokenCounter.count(summary) + 2,
    };
  }

  private messageText(m: CanonicalMessage): string {
    return m.content.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n");
  }
}