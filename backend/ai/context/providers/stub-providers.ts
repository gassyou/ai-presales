/**
 * 占位 Provider —— 6.0b 阶段。
 *
 * 实际逻辑在 6.0d 完成：
 *   - project-snapshot.provider：调 IProjectRepository.findSnapshotById
 *   - rag.provider：调 retrieve() (6.0c 的 Embedding + sqlite-vec)
 *   - mention-resolver：调 IProjectRepository 模糊匹配
 *
 * 这里提供"未实现"版本，注册到 SnapshotRegistry 后未调通的方法抛 NotImplemented。
 * 这样 6.0b 的 ContextAssembler 可以跑全链路测试，6.0d 替换实现即可。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type {
  ContextFragment,
  ProjectSnapshotProvider,
  RagProvider,
} from "./snapshot-registry.ts";

export class NotImplementedProviderError extends Error {
  constructor(provider: string, method: string) {
    super(`provider ${provider}.${method} not implemented yet (planned for 6.0d)`);
    this.name = "NotImplementedProviderError";
  }
}

/** 降级路径占位：未实现时返回 null，6.0d 替换 */
export class StubProjectSnapshotProvider implements ProjectSnapshotProvider {
  async summarize(_input: { projectId: ProjectId; maxTokens: number }): Promise<ContextFragment | null> {
    throw new NotImplementedProviderError("project-snapshot", "summarize");
  }
  async resolveMentions(
    _rawTokens: readonly string[],
  ): Promise<{ matched: Array<{ token: string; projectId: ProjectId }>; unmatched: string[] }> {
    throw new NotImplementedProviderError("project-snapshot", "resolveMentions");
  }
}

/** 主路径占位：未实现时返回空数组（视为"未入库"） */
export class StubRagProvider implements RagProvider {
  async retrieve(
    _input: { query: string; projectId: ProjectId; topK: number; minScore: number },
  ): Promise<readonly ContextFragment[]> {
    throw new NotImplementedProviderError("rag", "retrieve");
  }
}