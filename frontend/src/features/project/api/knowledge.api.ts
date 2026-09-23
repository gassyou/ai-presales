/**
 * Knowledge API —— 后端 knowledge 端点封装
 *
 * - ingest(projectId): POST /api/projects/:id/knowledge/ingest
 * - status(projectId): GET /api/projects/:id/knowledge/status
 *
 * 阶段 6.0g：项目详情页用。
 */

import { http } from "@frontend/shared/api/http-client.ts";

export interface KnowledgeIngestItemResult {
  readonly knowledgeId: string;
  readonly sourceMessageId: string;
  readonly chunkCount: number;
  readonly skippedReason?: "no_content" | "duplicate_source" | "embed_failed";
}

export interface KnowledgeIngestResult {
  readonly projectId: string;
  readonly scanned: number;
  readonly indexed: number;
  readonly skipped: number;
  readonly totalChunks: number;
  readonly elapsedMs: number;
  readonly lastIngestedAt: string | null;
  readonly items: readonly KnowledgeIngestItemResult[];
  readonly errors: Array<{ messageId: string; reason: string }>;
}

export interface KnowledgeStatusResult {
  readonly projectId: string;
  readonly isIndexed: boolean;
  readonly chunkCount: number;
  readonly knowledgeItemCount: number;
  readonly messageCount: number;
  readonly lastIngestedAt: string | null;
}

export const knowledgeApi = {
  /** 触发 ingest（同步） */
  ingest(projectId: string, opts?: { messageLimit?: number }) {
    return http.post<KnowledgeIngestResult>(
      `/api/projects/${projectId}/knowledge/ingest`,
      opts?.messageLimit !== undefined ? { messageLimit: opts.messageLimit } : {},
    );
  },
  /** 查询项目知识库状态 */
  status(projectId: string) {
    return http.get<KnowledgeStatusResult>(
      `/api/projects/${projectId}/knowledge/status`,
    );
  },
};