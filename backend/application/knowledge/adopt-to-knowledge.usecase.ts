/**
 * AdoptToKnowledgeUseCase —— 采纳单条 AI 回答到知识库
 *
 * 入参：assistant message 内容 + projectId
 * 流程：
 *   1. 构造 KnowledgeItem（manual）
 *   2. 切片 + embed + 写 knowledge_chunks
 *   3. dedupe：同 source_message_id 已有 → 跳过
 */

import type { AiSessionId, MessageId, ProjectId } from "@shared/types/ids.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import { KnowledgeItem, type KnowledgeItemSnapshot } from "@backend/domain/knowledge/knowledge-item.ts";
import type { IKnowledgeRepository } from "@backend/domain/knowledge/knowledge.repository.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";
import { KnowledgeChunk } from "@backend/domain/knowledge/knowledge-chunk.ts";
import { chunkText } from "@backend/persistence/sqlite/chunker.ts";
import type { EmbeddingProvider } from "@backend/ai/embedding/embedding-provider.ts";

export interface AdoptToKnowledgeArgs {
  projectId: ProjectId;
  sourceSessionId?: AiSessionId | null;
  sourceMessageId?: MessageId | null;
  title: string;
  body: string;
  clock: Clock;
}

export interface AdoptDeps {
  knowledgeRepo: IKnowledgeRepository;
  chunkRepo: IKnowledgeChunkRepository;
  embeddingProvider: EmbeddingProvider;
}

export class AdoptToKnowledgeUseCase {
  constructor(private readonly deps: AdoptDeps) {}

  async execute(args: AdoptToKnowledgeArgs): Promise<DomainResult<KnowledgeItemSnapshot>> {
    const { knowledgeRepo, chunkRepo, embeddingProvider } = this.deps;

    // dedupe
    if (args.sourceMessageId) {
      const existing = await knowledgeRepo.findBySourceMessage(args.sourceMessageId);
      if (existing) return domainOk(existing);
    }

    const r = KnowledgeItem.create({
      projectId: args.projectId,
      ...(args.sourceSessionId !== undefined ? { sourceSessionId: args.sourceSessionId } : {}),
      ...(args.sourceMessageId !== undefined ? { sourceMessageId: args.sourceMessageId } : {}),
      title: args.title,
      body: args.body,
      adoptionKind: "manual",
      clock: args.clock,
    });
    if (!r.ok) return r;

    // 切片
    const chunks = chunkText({ text: args.body });
    if (chunks.length === 0) {
      // 没有可切片的正文，但仍保存元数据
      const save = await knowledgeRepo.save(r.value);
      if (!save.ok) return save;
      return domainOk(r.value.snapshot());
    }

    // embed
    let vecs: Float32Array[];
    try {
      vecs = await embeddingProvider.embed(chunks.map((c) => c.text));
    } catch (e) {
      return domainErr("INTERNAL", `embed failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (vecs.length !== chunks.length) {
      return domainErr("INTERNAL", `embedding count mismatch: ${vecs.length} vs ${chunks.length}`);
    }

    // 写元数据 + chunks
    const save = await knowledgeRepo.save(r.value);
    if (!save.ok) return save;

    const knowledgeId = r.value.id;
    const knowledgeChunks: KnowledgeChunk[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const v = vecs[i];
      const cc = KnowledgeChunk.create({
        knowledgeId,
        projectId: args.projectId,
        sourceKind: "message",
        sourceRef: args.sourceMessageId ?? null,
        ordinal: c.ordinal,
        chunkText: c.text,
        tokenCount: c.tokenCount,
        embeddingModel: embeddingProvider.modelId,
        embeddingDim: embeddingProvider.dimension,
        embedding: v,
      });
      if (!cc.ok) return cc;
      knowledgeChunks.push(cc.value);
    }
    await chunkRepo.saveChunks(knowledgeChunks);

    return domainOk(r.value.snapshot());
  }
}