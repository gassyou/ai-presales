/**
 * IndexStatusUseCase ——「项目知识库状态」查询
 *
 * 阶段 6.0g。前端 AdoptToKnowledgeButton 渲染时拉一次：
 *   - isIndexed:   是否有 ≥1 个 chunk
 *   - chunkCount:  chunk 总数
 *   - lastIngestedAt: 最近一次 ingest 的时间（来自 ai_knowledge.adopted_at MAX）
 *   - messageCount: 该项目下 AI 消息总数（候选 ingest 目标）
 *
 * 设计：纯查询，不依赖任何外部 IO（除 chunkRepo + knowledgeRepo + sessionRepo）；
 * 是 RAG-first 策略的前置 gate（isIndexed 决定 @xxx 走 RAG 还是 200 token 摘要）。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "@backend/domain/shared/result.ts";
import { domainOk } from "@backend/domain/shared/result.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";
import type { IKnowledgeRepository } from "@backend/domain/knowledge/knowledge.repository.ts";
import type { IAiSessionRepository } from "@backend/domain/ai-session/ai-session.repository.ts";

export interface IndexStatusResult {
  readonly projectId: string;
  readonly isIndexed: boolean;
  readonly chunkCount: number;
  readonly knowledgeItemCount: number;
  readonly messageCount: number;
  readonly lastIngestedAt: string | null;
}

export interface IndexStatusDeps {
  knowledgeRepo: IKnowledgeRepository;
  chunkRepo: IKnowledgeChunkRepository;
  sessionRepo: IAiSessionRepository;
}

export class IndexStatusUseCase {
  constructor(private readonly deps: IndexStatusDeps) {}

  async execute(args: { projectId: ProjectId }): Promise<DomainResult<IndexStatusResult>> {
    const { knowledgeRepo, chunkRepo, sessionRepo } = this.deps;
    const chunkCount = await chunkRepo.countByProject(args.projectId);
    const list = await knowledgeRepo.list({ projectId: args.projectId, limit: 1, offset: 0 });
    const messages = await sessionRepo.listMessagesByProject(args.projectId, 100000);
    const lastIngestedAt = list.items.length > 0
      ? list.items[0].adoptedAt.toISOString()
      : null;
    return domainOk({
      projectId: args.projectId,
      isIndexed: chunkCount > 0,
      chunkCount,
      knowledgeItemCount: list.total,
      messageCount: messages.length,
      lastIngestedAt,
    });
  }
}