/**
 * search_knowledge —— RAG 检索
 *
 * 阶段 7.4h：const → class 以支持运行时配置（defaultTopK）。
 * 阶段 7.5（H12 修复）：构造期可选注入 RetrieveUseCase；
 *   不注入时仍返回空 hits（向后兼容 dev/测试）；注入后真正查知识库。
 */

import type { Tool } from "../tool.ts";
import { ok } from "../tool.ts";
import type { RetrieveUseCase } from "@backend/application/knowledge/retrieve.ts";

export interface SearchKnowledgeArgs {
  readonly query: string;
  readonly topK?: number;
  readonly projectId?: string;
}

export interface SearchKnowledgeResult {
  readonly query: string;
  readonly hits: Array<{
    readonly id: string;
    readonly title: string;
    readonly snippet: string;
    readonly score: number;
  }>;
  readonly note: string;
}

const DEFAULT_TOP_K = 5;

export interface SearchKnowledgeToolDeps {
  /** 注入后真正查知识库；不注入则返空 hits（占位） */
  readonly retrieve?: RetrieveUseCase;
}

export class SearchKnowledgeTool implements Tool<SearchKnowledgeArgs, SearchKnowledgeResult> {
  readonly name = "search_knowledge";
  readonly description = "在已采纳的知识库里检索相关条目。";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "自然语言查询" },
      topK: { type: "integer", minimum: 1, maximum: 20, default: DEFAULT_TOP_K },
      projectId: { type: "string", description: "限定到某个项目（可选）" },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = false;
  readonly sideEffect: "read" = "read";

  private defaultTopK = DEFAULT_TOP_K;

  constructor(private readonly deps: SearchKnowledgeToolDeps = {}) {}

  configure(opts: Record<string, unknown>): void {
    if (typeof opts.defaultTopK === "number" && opts.defaultTopK >= 1) {
      this.defaultTopK = Math.floor(opts.defaultTopK);
    }
  }

  async execute(args: SearchKnowledgeArgs): Promise<import("../tool.ts").ToolResult<SearchKnowledgeResult>> {
    const query = args?.query ?? "";
    const topK = args?.topK ?? this.defaultTopK;

    if (!this.deps.retrieve) {
      // 占位 fallback：与原行为一致（不破测试 / dev.ts）
      return ok({
        query,
        hits: [],
        note: `search_knowledge: query="${query}", topK=${topK}. RAG 召回依赖上下文（retrieve not injected）。`,
      });
    }

    try {
      // projectId 必填；若调用方没传，retrieve 会 INTERNAL；我们兜底成无 projectId 命中（让 tool 仍能用）
      const projectId = (args.projectId ?? "") as import("@shared/types/ids.ts").ProjectId;
      const r = await this.deps.retrieve.execute({
        query,
        projectId,
        topK,
        minScore: 0,
      });
      if (!r.ok) {
        return ok({
          query,
          hits: [],
          note: `search_knowledge: query="${query}", topK=${topK}. retrieve failed: ${r.error.message}`,
        });
      }
      const hits = r.value.map((hit) => ({
        id: hit.chunk.id,
        title: hit.chunk.sourceRef ?? `(chunk #${hit.chunk.ordinal})`,
        snippet: hit.chunk.chunkText.slice(0, 200),
        score: hit.score,
      }));
      return ok({
        query,
        hits,
        note: `search_knowledge: query="${query}", topK=${topK} → ${hits.length} hits.`,
      });
    } catch (e) {
      return ok({
        query,
        hits: [],
        note: `search_knowledge: query="${query}", topK=${topK}. exception: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

/** 向后兼容的 const 引用（不注入 retrieve → 占位 fallback） */
export const searchKnowledgeTool: Tool<SearchKnowledgeArgs, SearchKnowledgeResult> = new SearchKnowledgeTool();