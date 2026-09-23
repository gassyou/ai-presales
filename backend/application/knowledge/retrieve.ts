/**
 * retrieve —— RAG / LIKE 派发
 *
 * 读取 knowledge_vec_status：
 *   - 'loaded'    → 走 VecKnowledgeChunkRepository.searchByVec（cosine 距离；本阶段 stub）
 *   - 'missing'   → 走 SqliteKnowledgeChunkRepository.searchByLike
 *   - 'failed'    → 同 missing + 记录 reason
 *
 * 阶段 6.0c：vec 路径未实装（依赖 vec0 扩展的 SQL 语法），统一走 LIKE。
 * 6.0d / 后续可加 VecKnowledgeChunkRepository。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "@backend/domain/shared/result.ts";
import { domainErr, domainOk } from "@backend/domain/shared/result.ts";
import type { KnowledgeChunkSnapshot } from "@backend/domain/knowledge/knowledge-chunk.ts";
import { SqliteKnowledgeChunkRepository } from "@backend/persistence/sqlite/sqlite-knowledge-chunk.repository.ts";
import type { EmbeddingProvider } from "@backend/ai/embedding/embedding-provider.ts";

export interface RagHit {
  readonly chunk: KnowledgeChunkSnapshot;
  readonly score: number;
}

export interface RetrieveArgs {
  query: string;
  projectId: ProjectId;
  topK: number;
  minScore: number;
}

export interface RetrieveDeps {
  chunkRepo: SqliteKnowledgeChunkRepository;
  embeddingProvider: EmbeddingProvider;
}

export class RetrieveUseCase {
  constructor(private readonly deps: RetrieveDeps) {}

  async execute(args: RetrieveArgs): Promise<DomainResult<readonly RagHit[]>> {
    const status = this.deps.chunkRepo.readVecStatus();
    if (!status || status.status === "missing" || status.status === "failed") {
      // 软降级 → LIKE
      const like = await this.deps.chunkRepo.searchByLike(args.projectId, args.query, args.topK);
      return domainOk(like.map((c) => ({ chunk: c, score: 0.5 })));
    }
    // loaded → vec 路径（阶段 6.0c 未实装；6.0d 加 VecKnowledgeChunkRepository）
    return domainErr(
      "INTERNAL",
      "vec0 cosine search not yet implemented (planned for 6.0d)",
    );
  }
}