/**
 * SqliteRagProvider —— 真实实现（替换 6.0b 占位）
 *
 * retrieve({ query, projectId, topK, minScore }):
 *   - 委托给 application/knowledge/retrieve.ts 的 RetrieveUseCase
 *   - vec0 装载成功 → vec 路径（cosine 距离）；否则走 LIKE 软降级（score 0.5）
 *   - 返回 ContextFragment[]，每块带 projectId / title / content
 *
 * ContextAssembler 装配时直接读 .source/.projectId/.title/.content/.tokensUsed。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { RetrieveUseCase } from "@backend/application/knowledge/retrieve.ts";
import { truncateToTokens } from "../context-budget.ts";
import type { TokenCounter } from "../token-counter.ts";
import type { ContextFragment, RagProvider } from "../snapshot-registry.ts";

export interface RagProviderDeps {
  retrieve: RetrieveUseCase;
  tokenCounter: TokenCounter;
}

export class SqliteRagProvider implements RagProvider {
  constructor(private readonly deps: RagProviderDeps) {}

  async retrieve(input: {
    query: string;
    projectId: ProjectId;
    topK: number;
    minScore: number;
  }): Promise<readonly ContextFragment[]> {
    const { retrieve, tokenCounter } = this.deps;
    const result = await retrieve.execute({
      query: input.query,
      projectId: input.projectId,
      topK: input.topK,
      minScore: input.minScore,
    });
    if (!result.ok) return [];

    return result.value.map((hit, idx): ContextFragment => {
      const raw = `### 命中 #${idx + 1}（score=${hit.score.toFixed(2)}）\n${hit.chunk.chunkText}`;
      // 单块按 ~500 token 截；rag 段总额在外层 truncate
      const content = truncateToTokens(raw, 600, tokenCounter);
      return {
        source: "rag",
        projectId: input.projectId,
        title: `知识命中 §${hit.chunk.ordinal}`,
        content,
        tokensUsed: tokenCounter.count(content),
      };
    });
  }
}