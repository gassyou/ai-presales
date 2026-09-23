/**
 * ContextBudget —— 上下文预算分配
 *
 * 总额 = 上下文窗口 - 预留输出（profile.max_tokens）
 * 分配：
 *   system_prompt         8%
 *   project_context       12%   (当前项目摘要 + @引用项目摘要，未入库路径)
 *   rag_hits              20%   (RAG 召回，未入库项目用 projectContext 代替)
 *   business_modules      30%   (按 score 选 Top-K)
 *   conversation_history  25%   (智能截断 / 摘要)
 *   user_input             5%   (最后一段 user 内容)
 *
 * 预算用纯函数算；具体填什么由 ContextAssembler 决定。
 */

export interface BudgetConfig {
  /** LLM 上下文窗口大小（tokens） */
  readonly contextWindow: number;
  /** 预留输出空间（profile.max_tokens） */
  readonly maxOutputTokens: number;
}

export interface ContextBudget {
  readonly total: number;
  readonly systemPrompt: number;
  readonly projectContext: number;
  readonly ragHits: number;
  readonly businessModules: number;
  readonly conversationHistory: number;
  readonly userInput: number;
}

/** 比例表（合计 1.00） */
const RATIOS = {
  systemPrompt: 0.08,
  projectContext: 0.12,
  ragHits: 0.20,
  businessModules: 0.30,
  conversationHistory: 0.25,
  userInput: 0.05,
} as const;

export function calculateBudget(cfg: BudgetConfig): ContextBudget {
  const total = Math.max(0, cfg.contextWindow - cfg.maxOutputTokens);
  return {
    total,
    systemPrompt: Math.floor(total * RATIOS.systemPrompt),
    projectContext: Math.floor(total * RATIOS.projectContext),
    ragHits: Math.floor(total * RATIOS.ragHits),
    businessModules: Math.floor(total * RATIOS.businessModules),
    conversationHistory: Math.floor(total * RATIOS.conversationHistory),
    userInput: Math.max(1, Math.floor(total * RATIOS.userInput)),
  };
}

/** 把字符串裁剪到不超过 maxTokens（粗按字符 1:1 反推；CJK 会更准） */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  tokenCounter: { count: (s: string) => number },
): string {
  if (tokenCounter.count(text) <= maxTokens) return text;
  const ellipsis = "…";
  const ellipsisTokens = tokenCounter.count(ellipsis);
  const targetContentTokens = Math.max(0, maxTokens - ellipsisTokens);

  // 二分查找最长合法前缀（不含省略号）
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tokenCounter.count(text.slice(0, mid)) <= targetContentTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // 在 lo 之前的最近换行 / 句号处截断，避免半字
  const cut = text.slice(0, lo);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf("。"), cut.lastIndexOf("."), cut.lastIndexOf(" "));
  if (lastBreak > lo * 0.7) {
    const out = cut.slice(0, lastBreak) + ellipsis;
    return tokenCounter.count(out) <= maxTokens ? out : cut + ellipsis;
  }
  return cut + ellipsis;
}