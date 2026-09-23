/**
 * IngestProjectUseCase ——「加入知识库」按钮触发
 *
 * 阶段 6.0g 实现。把项目下所有 AI 历史消息（user + assistant）按 chunk 切片、
 * embed、入 knowledge_chunks；同时为每个被采纳的消息建一个 KnowledgeItem 元数据。
 *
 * 流程：
 *   1. IAiSessionRepository.listMessagesByProject 拿全部正文消息
 *   2. 对每条 message：
 *      - KnowledgeItem.create (adoption_kind='manual_ingest') + knowledgeRepo.save
 *      - chunkText(body) → embed → KnowledgeChunk.create × N → chunkRepo.saveChunks
 *   3. 返回 IngestResult{ items, totalChunks, totalMessages, elapsedMs, lastIngestedAt }
 *
 * 设计：
 *   - 幂等：sourceMessageId 唯一约束 → 已采纳的 message 跳过（AdoptToKnowledge 已 dedupe）
 *   - limit: 上限防止 OOM；默认 1000 条消息（一般项目远不到）
 *   - 错误单条不阻塞整批（try/catch 包每条）
 *   - "ingest_project" 标识这一批是按钮触发的（区别于 adopt_to_knowledge 的人工采纳）
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import { KnowledgeItem, type KnowledgeItemSnapshot } from "@backend/domain/knowledge/knowledge-item.ts";
import type { IKnowledgeRepository } from "@backend/domain/knowledge/knowledge.repository.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";
import type { IAiSessionRepository } from "@backend/domain/ai-session/ai-session.repository.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";
import { chunkText } from "@backend/persistence/sqlite/chunker.ts";
import type { EmbeddingProvider } from "@backend/ai/embedding/embedding-provider.ts";

export interface IngestProjectArgs {
  projectId: ProjectId;
  /** 上限消息数；默认 1000 */
  messageLimit?: number;
  clock: Clock;
}

export interface IngestProjectItemResult {
  readonly knowledgeId: string;
  readonly sourceMessageId: string;
  readonly chunkCount: number;
  readonly skippedReason?: "no_content" | "duplicate_source" | "embed_failed";
}

export interface IngestProjectResult {
  readonly projectId: string;
  readonly scanned: number;        // 扫描到的消息数
  readonly indexed: number;         // 实际新建的 knowledge items
  readonly skipped: number;        // 跳过的
  readonly totalChunks: number;    // 新写入的 chunks 总数
  readonly elapsedMs: number;
  readonly lastIngestedAt: string | null; // ISO
  readonly items: readonly IngestProjectItemResult[];
  readonly errors: Array<{ messageId: string; reason: string }>;
}

export interface IngestProjectDeps {
  sessionRepo: IAiSessionRepository;
  knowledgeRepo: IKnowledgeRepository;
  chunkRepo: IKnowledgeChunkRepository;
  embeddingProvider: EmbeddingProvider;
}

const INGEST_KIND = "manual_ingest" as const;

export class IngestProjectUseCase {
  constructor(private readonly deps: IngestProjectDeps) {}

  async execute(args: IngestProjectArgs): Promise<DomainResult<IngestProjectResult>> {
    const { sessionRepo, knowledgeRepo, chunkRepo, embeddingProvider } = this.deps;
    const limit = args.messageLimit ?? 1000;
    const t0 = Date.now();

    const messages = await sessionRepo.listMessagesByProject(args.projectId, limit);

    let indexed = 0;
    let skipped = 0;
    let totalChunks = 0;
    const items: IngestProjectItemResult[] = [];
    const errors: Array<{ messageId: string; reason: string }> = [];

    for (const m of messages) {
      const content = m.content.trim();
      if (content.length === 0) {
        skipped++;
        items.push({ knowledgeId: "", sourceMessageId: m.messageId, chunkCount: 0, skippedReason: "no_content" });
        continue;
      }
      // dedupe by sourceMessageId
      const existing: KnowledgeItemSnapshot | null = await knowledgeRepo.findBySourceMessage(m.messageId);
      if (existing) {
        skipped++;
        items.push({ knowledgeId: existing.id, sourceMessageId: m.messageId, chunkCount: 0, skippedReason: "duplicate_source" });
        continue;
      }
      try {
        const itemR = KnowledgeItem.create({
          projectId: args.projectId,
          sourceMessageId: m.messageId as unknown as import("@shared/types/ids.ts").MessageId,
          sourceSessionId: m.sessionId as unknown as import("@shared/types/ids.ts").AiSessionId,
          title: content.slice(0, 60) || "(空)",
          body: content,
          adoptionKind: INGEST_KIND,
          clock: args.clock,
        });
        if (!itemR.ok) {
          skipped++;
          errors.push({ messageId: m.messageId, reason: itemR.error.message });
          items.push({ knowledgeId: "", sourceMessageId: m.messageId, chunkCount: 0, skippedReason: "no_content" });
          continue;
        }
        const saveR = await knowledgeRepo.save(itemR.value);
        if (!saveR.ok) {
          skipped++;
          errors.push({ messageId: m.messageId, reason: saveR.error.message });
          items.push({ knowledgeId: "", sourceMessageId: m.messageId, chunkCount: 0, skippedReason: "no_content" });
          continue;
        }

        const chunks = chunkText({ text: content });
        if (chunks.length === 0) {
          indexed++;
          items.push({ knowledgeId: itemR.value.id, sourceMessageId: m.messageId, chunkCount: 0 });
          continue;
        }
        const vecs = await embeddingProvider.embed(chunks.map((c) => c.text));
        if (vecs.length !== chunks.length) {
          throw new Error(`embedding count mismatch: ${vecs.length} vs ${chunks.length}`);
        }
        const knowledgeChunks: KnowledgeChunk[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          const v = vecs[i];
          const cc = KnowledgeChunk.create({
            knowledgeId: itemR.value.id,
            projectId: args.projectId,
            sourceKind: "message",
            sourceRef: m.messageId,
            ordinal: c.ordinal,
            chunkText: c.text,
            tokenCount: c.tokenCount,
            embeddingModel: embeddingProvider.modelId,
            embeddingDim: embeddingProvider.dimension,
            embedding: v,
          });
          if (!cc.ok) throw new Error(cc.error.message);
          knowledgeChunks.push(cc.value);
        }
        await chunkRepo.saveChunks(knowledgeChunks);
        indexed++;
        totalChunks += knowledgeChunks.length;
        items.push({ knowledgeId: itemR.value.id, sourceMessageId: m.messageId, chunkCount: knowledgeChunks.length });
      } catch (e) {
        skipped++;
        const reason = e instanceof Error ? e.message : String(e);
        errors.push({ messageId: m.messageId, reason });
        items.push({ knowledgeId: "", sourceMessageId: m.messageId, chunkCount: 0, skippedReason: "embed_failed" });
      }
    }

    return domainOk({
      projectId: args.projectId,
      scanned: messages.length,
      indexed,
      skipped,
      totalChunks,
      elapsedMs: Date.now() - t0,
      lastIngestedAt: new Date().toISOString(),
      items,
      errors,
    });
  }
}