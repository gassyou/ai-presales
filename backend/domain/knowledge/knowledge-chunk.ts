/**
 * KnowledgeChunk —— 切片值对象
 *
 * 一个 KnowledgeItem 可切多个 chunk；
 * 每个 chunk 带 embedding + 元数据，供 vec / LIKE 检索。
 */

import { KnowledgeItemId, newId } from "@shared/types/ids.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { KnowledgeItemId as toKnowledgeItemId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import { domainErr, domainOk } from "../shared/result.ts";

export type ChunkSourceKind = "message" | "module_summary" | "file" | "manual";

export interface KnowledgeChunkSnapshot {
  id: string;
  knowledgeId: KnowledgeItemId;
  projectId: ProjectId;
  sourceKind: ChunkSourceKind;
  sourceRef: string | null;
  ordinal: number;
  chunkText: string;
  tokenCount: number;
  embeddingModel: string;
  embeddingDim: number;
  /** Float32 little-endian 二进制；vec 缺失时为 null，降级 LIKE */
  vecBlob: Uint8Array | null;
  isDirty: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeChunkArgs {
  knowledgeId: KnowledgeItemId;
  projectId: ProjectId;
  sourceKind: ChunkSourceKind;
  sourceRef?: string | null;
  ordinal: number;
  chunkText: string;
  tokenCount: number;
  embeddingModel: string;
  embeddingDim: number;
  /** Float32[] → Uint8Array via Float32Array.buffer */
  embedding: Float32Array;
  id?: string;
}

export class KnowledgeChunk {
  private constructor(
    private readonly _id: string,
    private readonly _knowledgeId: KnowledgeItemId,
    private readonly _projectId: ProjectId,
    private readonly _sourceKind: ChunkSourceKind,
    private readonly _sourceRef: string | null,
    private readonly _ordinal: number,
    private readonly _chunkText: string,
    private readonly _tokenCount: number,
    private readonly _embeddingModel: string,
    private readonly _embeddingDim: number,
    private readonly _vecBlob: Uint8Array | null,
    private readonly _isDirty: boolean,
    private readonly _createdAt: Date,
    private readonly _updatedAt: Date,
  ) {}

  static create(args: CreateKnowledgeChunkArgs, now: Date = new Date()): DomainResult<KnowledgeChunk> {
    if (!args.chunkText || args.chunkText.trim().length === 0) {
      return domainErr("INVALID_INPUT", "chunkText is required");
    }
    if (args.tokenCount <= 0) {
      return domainErr("INVALID_INPUT", "tokenCount must be positive");
    }
    if (args.embedding.length !== args.embeddingDim) {
      return domainErr(
        "INVALID_INPUT",
        `embedding length ${args.embedding.length} != dimension ${args.embeddingDim}`,
      );
    }
    const id = args.id ?? crypto.randomUUID();
    // Float32 → Uint8Array little-endian
    const blob = new Uint8Array(args.embedding.buffer.slice(0));
    return domainOk(
      new KnowledgeChunk(
        id,
        args.knowledgeId,
        args.projectId,
        args.sourceKind,
        args.sourceRef ?? null,
        args.ordinal,
        args.chunkText,
        args.tokenCount,
        args.embeddingModel,
        args.embeddingDim,
        blob,
        false,
        now,
        now,
      ),
    );
  }

  static rehydrate(snap: KnowledgeChunkSnapshot): KnowledgeChunk {
    return new KnowledgeChunk(
      snap.id,
      snap.knowledgeId,
      snap.projectId,
      snap.sourceKind,
      snap.sourceRef,
      snap.ordinal,
      snap.chunkText,
      snap.tokenCount,
      snap.embeddingModel,
      snap.embeddingDim,
      snap.vecBlob,
      snap.isDirty,
      snap.createdAt,
      snap.updatedAt,
    );
  }

  get id(): string { return this._id; }
  get knowledgeId(): KnowledgeItemId { return this._knowledgeId; }
  get projectIdValue(): ProjectId { return this._projectId; }
  get sourceKindValue(): ChunkSourceKind { return this._sourceKind; }
  get sourceRef(): string | null { return this._sourceRef; }
  get ordinalValue(): number { return this._ordinal; }
  get chunkText(): string { return this._chunkText; }
  get tokenCountValue(): number { return this._tokenCount; }
  get embeddingModel(): string { return this._embeddingModel; }
  get embeddingDimValue(): number { return this._embeddingDim; }
  get vecBlob(): Uint8Array | null { return this._vecBlob; }
  get isDirty(): boolean { return this._isDirty; }
  get createdAtValue(): Date { return this._createdAt; }
  get updatedAtValue(): Date { return this._updatedAt; }

  /** 解码 vecBlob → Float32Array（仅用于距离计算；不要持久化回写） */
  decodeEmbedding(): Float32Array | null {
    if (!this._vecBlob) return null;
    return new Float32Array(this._vecBlob.buffer, this._vecBlob.byteOffset, this._embeddingDim);
  }

  snapshot(): KnowledgeChunkSnapshot {
    return {
      id: this._id,
      knowledgeId: this._knowledgeId,
      projectId: this._projectId,
      sourceKind: this._sourceKind,
      sourceRef: this._sourceRef,
      ordinal: this._ordinal,
      chunkText: this._chunkText,
      tokenCount: this._tokenCount,
      embeddingModel: this._embeddingModel,
      embeddingDim: this._embeddingDim,
      vecBlob: this._vecBlob,
      isDirty: this._isDirty,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }
}