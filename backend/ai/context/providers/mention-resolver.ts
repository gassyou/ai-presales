/**
 * MentionResolver —— 把 @xxx 字面解析为 ProjectId + isIndexed
 *
 * 流程：
 *   1. ProjectRepository.findByMentionToken(token) 模糊匹配
 *   2. 命中 → 再查 IKnowledgeChunkRepository.countByProject → >0 视为已入库
 *   3. 返回 ContextAssembler.assemble() 需要的 lookup 函数形态：
 *        (token: string) => { projectId, isIndexed } | null
 *
 * 注意：
 *   - 没匹配到的 token 不在这里处理；ContextAssembler 自己降级为字面
 *   - isIndexed 只决定走 RAG 还是 200 token 摘要；不决定"是否拼到 system prompt"
 *     （未匹配的 mention 也仍作为字面文本出现在 userInput 里）
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { IProjectRepository } from "@backend/domain/project/project.repository.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";

export interface MentionResolverDeps {
  projectRepo: IProjectRepository;
  chunkRepo: IKnowledgeChunkRepository;
}

export type ProjectLookup = (token: string) => Promise<{ projectId: ProjectId; isIndexed: boolean } | null>;

export class MentionResolver {
  private readonly cache = new Map<string, { projectId: ProjectId; isIndexed: boolean } | null>();

  constructor(private readonly deps: MentionResolverDeps) {}

  /**
   * 返回 ContextAssembler 用的 lookup 函数；带进程内 cache 避免重复查 DB。
   */
  asProjectLookup(): ProjectLookup {
    return async (token: string) => {
      const key = token.toLowerCase();
      if (this.cache.has(key)) return this.cache.get(key)!;
      const snap = await this.deps.projectRepo.findByMentionToken(token);
      if (!snap) {
        this.cache.set(key, null);
        return null;
      }
      const chunkCount = await this.deps.chunkRepo.countByProject(snap.id);
      const result = { projectId: snap.id, isIndexed: chunkCount > 0 };
      this.cache.set(key, result);
      return result;
    };
  }

  /** 清缓存（用于 ingest 后让 isIndexed 状态立即生效） */
  invalidateCache(): void {
    this.cache.clear();
  }
}