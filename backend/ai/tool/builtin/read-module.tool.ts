/**
 * read_module —— LLM 按需深入项目模块
 *
 * 阶段 6.0g 实现。在 ContextAssembler 装配的"项目摘要"基础上，让 LLM 主动拉
 * 某个项目的某个模块的更详细内容，避免一开始就把所有模块都塞进 system prompt。
 *
 * 输入：
 *   - projectCodeOrName:  项目编号（如 "2026-00001"）或名称
 *   - moduleName:         业务模块名（如 "现状分析"、"痛点"、"ROI"），或留空 = 项目摘要
 *   - maxTokens?:         截断上限（默认 2000）
 *
 * 行为：
 *   1. projectRepo.findByMentionToken 解析 → ProjectId
 *   2. 项目已入库（chunks > 0）→ 走 RagProvider.retrieve（topK=5）
 *   3. 未入库 → 走 ProjectSnapshotProvider.summarize（更详细版，maxTokens）
 *   4. 都失败 → 返回 fail（不要编造）
 *
 * 注入：
 *   - deps.snapshotRegistry: 走 SnapshotRegistry 拿 providers
 *   - deps.projectRepo: 解析 token
 *   - deps.tokenCounter: 截断
 *
 * 注意：本工具只查"项目级"模块；具体业务模块（"现状分析"等）的数据由 7+ 阶段的
 * BusinessModuleSnapshotProvider 提供，这里 fallback 到模块摘要。
 */

import type { Tool } from "../tool.ts";
import { fail, ok } from "../tool.ts";
import { truncateToTokens } from "../../context/context-budget.ts";
import type { TokenCounter } from "../../context/token-counter.ts";
import type { IProjectRepository } from "@backend/domain/project/project.repository.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";
import type { SnapshotRegistry } from "../../context/snapshot-registry.ts";

export interface ReadModuleArgs {
  /** 项目编号或名称 */
  readonly projectCodeOrName: string;
  /** 业务模块名；不传则给项目级摘要 */
  readonly moduleName?: string;
  /** 最大 token（默认 2000） */
  readonly maxTokens?: number;
}

export interface ReadModuleResult {
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly moduleName: string;
  /** "summary" | "rag" | "unindexed" */
  readonly strategy: "summary" | "rag" | "unindexed";
  readonly content: string;
  readonly tokensUsed: number;
  readonly note: string;
}

export interface ReadModuleToolDeps {
  readonly projectRepo: IProjectRepository;
  readonly chunkRepo: IKnowledgeChunkRepository;
  readonly registry: SnapshotRegistry;
  readonly tokenCounter: TokenCounter;
}

const DEFAULT_MAX_TOKENS = 2000;

export class ReadModuleTool implements Tool<ReadModuleArgs, ReadModuleResult> {
  readonly name = "read_module";
  readonly description =
    "按需深入读某个项目的某个模块。已入库项目走 RAG 召回，未入库项目走更详细摘要。" +
    "用于 ContextAssembler 默认只拼 200 token 摘要时，让 LLM 主动拿全模块内容。";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    required: ["projectCodeOrName"],
    properties: {
      projectCodeOrName: {
        type: "string",
        description: "项目编号（如 2026-00001）或项目名称",
      },
      moduleName: {
        type: "string",
        description: "业务模块名（现状分析/痛点/ROI 等）；不传则给项目级摘要",
      },
      maxTokens: {
        type: "integer",
        minimum: 100,
        maximum: 16000,
        default: DEFAULT_MAX_TOKENS,
      },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = false;
  readonly sideEffect: "read" = "read";

  constructor(private readonly deps: ReadModuleToolDeps) {}

  private defaultMaxTokens = DEFAULT_MAX_TOKENS;

  /** 阶段 7.4h：运行时覆盖默认 maxTokens */
  configure(opts: Record<string, unknown>): void {
    if (typeof opts.defaultMaxTokens === "number" && opts.defaultMaxTokens >= 100) {
      this.defaultMaxTokens = Math.floor(opts.defaultMaxTokens);
    }
  }

  async execute(args: ReadModuleArgs, _ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<ReadModuleResult>> {
    const projectRepo = this.deps.projectRepo;
    const chunkRepo = this.deps.chunkRepo;
    const registry = this.deps.registry;
    const tokenCounter = this.deps.tokenCounter;

    const token = (args?.projectCodeOrName ?? "").trim();
    if (token.length === 0) return fail("projectCodeOrName is required");
    const maxTokens = args?.maxTokens ?? this.defaultMaxTokens;
    const moduleName = (args?.moduleName ?? "").trim();

    const snap = await projectRepo.findByMentionToken(token);
    if (!snap) return fail(`project not found: ${token}`);

    // 1) 已入库 → RAG
    const chunkCount = await chunkRepo.countByProject(snap.id);
    if (chunkCount > 0) {
      const rag = registry.getRagProvider();
      if (rag) {
        const query = moduleName
          ? `${snap.name} ${moduleName}`
          : `${snap.name} 项目摘要 现状 痛点 方案`;
        const hits = await rag.retrieve({
          query,
          projectId: snap.id,
          topK: 5,
          minScore: 0.0,
        });
        if (hits.length === 0) {
          return ok({
            projectId: snap.id,
            projectCode: snap.code,
            projectName: snap.name,
            moduleName: moduleName || "(项目全貌)",
            strategy: "rag",
            content: `(知识库无命中 chunks)`,
            tokensUsed: 0,
            note: `项目 ${snap.code} 已入库（${chunkCount} 块），但 RAG 召回为空。请尝试更宽泛的关键词。`,
          });
        }
        const raw = hits.map((h, i) => `### 命中 #${i + 1}\n${h.content}`).join("\n\n");
        const content = truncateToTokens(raw, maxTokens, tokenCounter);
        return ok({
          projectId: snap.id,
          projectCode: snap.code,
          projectName: snap.name,
          moduleName: moduleName || "(项目全貌)",
          strategy: "rag",
          content,
          tokensUsed: tokenCounter.count(content),
          note: `RAG 召回 ${hits.length} 块（项目 ${snap.code} 知识库共 ${chunkCount} 块）`,
        });
      }
    }

    // 2) 未入库 → 项目级摘要 / 模块级 provider
    if (moduleName) {
      const provider = registry.getModule(moduleName);
      if (provider) {
        const frag = await provider.summarize({ projectId: snap.id, maxTokens });
        if (frag) {
          return ok({
            projectId: snap.id,
            projectCode: snap.code,
            projectName: snap.name,
            moduleName,
            strategy: "summary",
            content: frag.content,
            tokensUsed: tokenCounter.count(frag.content),
            note: `未入库项目；调模块 provider "${moduleName}" 拿摘要`,
          });
      }
      }
    }

    // 3) 兜底：ProjectSnapshotProvider
    const projProvider = registry.getProjectProvider();
    if (projProvider) {
      const frag = await projProvider.summarize({
        projectId: snap.id,
        maxTokens,
      });
      if (frag) {
        return ok({
          projectId: snap.id,
          projectCode: snap.code,
          projectName: snap.name,
          moduleName: moduleName || "(项目摘要)",
          strategy: chunkCount > 0 ? "rag" : "unindexed",
          content: frag.content,
          tokensUsed: tokenCounter.count(frag.content),
          note: chunkCount > 0
            ? `项目已入库（${chunkCount} 块）但 rag provider 未注册；fallback 摘要`
            : `未入库项目；调 ProjectSnapshotProvider 拿 ${maxTokens} token 摘要`,
        });
      }
    }

    return fail(`no data source available for project ${snap.code} module=${moduleName}`);
  }
}