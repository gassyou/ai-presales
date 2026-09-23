/**
 * KnowledgeItem —— 已采纳知识的聚合根元数据
 *
 * ai_knowledge 表存元数据；
 * knowledge_chunks 表存切片 + embedding；
 * 6.0c 阶段只读 / 写 ai_knowledge 元数据，knowledge_chunks 由 6.0c sqlite 仓储负责。
 */

import { KnowledgeItemId, newId, KnowledgeItemId as toKnowledgeItemId } from "@shared/types/ids.ts";
import type { AiSessionId, MessageId, ProjectId } from "@shared/types/ids.ts";
import { AggregateRoot } from "../shared/aggregate-root.ts";
import type { Clock } from "../shared/domain-event.ts";
import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";

export type AdoptionKind = "manual" | "auto_high_cited" | "manual_ingest";

export interface KnowledgeItemSnapshot {
  id: KnowledgeItemId;
  projectId: ProjectId;
  sourceSessionId: AiSessionId | null;
  sourceMessageId: MessageId | null;
  title: string;
  body: string;
  adoptedAt: Date;
  adoptionKind: AdoptionKind;
}

export interface CreateKnowledgeItemArgs {
  projectId: ProjectId;
  sourceSessionId?: AiSessionId | null;
  sourceMessageId?: MessageId | null;
  title: string;
  body: string;
  adoptionKind: AdoptionKind;
  clock: Clock;
  id?: KnowledgeItemId;
}

export class KnowledgeItem extends AggregateRoot<KnowledgeItemId> {
  private readonly _projectId: ProjectId;
  private readonly _sourceSessionId: AiSessionId | null;
  private readonly _sourceMessageId: MessageId | null;
  private readonly _title: string;
  private readonly _body: string;
  private readonly _adoptedAt: Date;
  private readonly _adoptionKind: AdoptionKind;

  private constructor(
    id: KnowledgeItemId,
    projectId: ProjectId,
    sourceSessionId: AiSessionId | null,
    sourceMessageId: MessageId | null,
    title: string,
    body: string,
    adoptedAt: Date,
    adoptionKind: AdoptionKind,
  ) {
    super(id);
    this._projectId = projectId;
    this._sourceSessionId = sourceSessionId;
    this._sourceMessageId = sourceMessageId;
    this._title = title;
    this._body = body;
    this._adoptedAt = adoptedAt;
    this._adoptionKind = adoptionKind;
  }

  static create(args: CreateKnowledgeItemArgs): DomainResult<KnowledgeItem> {
    const title = args.title?.trim() ?? "";
    const body = args.body?.trim() ?? "";
    if (title.length === 0) return domainErr("INVALID_INPUT", "title is required");
    if (title.length > 200) return domainErr("INVALID_INPUT", "title too long (max 200)");
    if (body.length === 0) return domainErr("INVALID_INPUT", "body is required");
    if (body.length > 100_000) return domainErr("INVALID_INPUT", "body too long (max 100000)");
    const id = args.id ?? toKnowledgeItemId(newId<"KnowledgeItemId">());
    const item = new KnowledgeItem(
      id,
      args.projectId,
      args.sourceSessionId ?? null,
      args.sourceMessageId ?? null,
      title,
      body,
      args.clock.now(),
      args.adoptionKind,
    );
    return domainOk(item);
  }

  static rehydrate(snap: KnowledgeItemSnapshot): KnowledgeItem {
    return new KnowledgeItem(
      snap.id,
      snap.projectId,
      snap.sourceSessionId,
      snap.sourceMessageId,
      snap.title,
      snap.body,
      snap.adoptedAt,
      snap.adoptionKind,
    );
  }

  get projectIdValue(): ProjectId {
    return this._projectId;
  }
  get sourceSessionIdValue(): AiSessionId | null {
    return this._sourceSessionId;
  }
  get sourceMessageIdValue(): MessageId | null {
    return this._sourceMessageId;
  }
  get titleValue(): string {
    return this._title;
  }
  get bodyValue(): string {
    return this._body;
  }
  get adoptedAtValue(): Date {
    return this._adoptedAt;
  }
  get adoptionKindValue(): AdoptionKind {
    return this._adoptionKind;
  }

  snapshot(): KnowledgeItemSnapshot {
    return {
      id: this.id,
      projectId: this._projectId,
      sourceSessionId: this._sourceSessionId,
      sourceMessageId: this._sourceMessageId,
      title: this._title,
      body: this._body,
      adoptedAt: this._adoptedAt,
      adoptionKind: this._adoptionKind,
    };
  }
}