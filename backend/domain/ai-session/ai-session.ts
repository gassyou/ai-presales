/**
 * AiSession 聚合根
 *
 * 状态：
 *   active | completed | aborted
 *
 * 不变量：
 *   - active 状态下可 appendMessage / adopt / abort
 *   - completed / aborted 状态下不可再 append / adopt
 *   - 引用计分：citedMessageIds 在助手消息 append 时累加
 *
 * 仓储交互：
 *   - save(agg) → 一个事务写 ai_sessions + 全部 messages
 *   - 事件 addDomainEvent 在 commit 时由仓储 pull
 */

import { AiSessionId, newId, type ProjectId, AiSessionId as toAiSessionId } from "@shared/types/ids.ts";
import { AggregateRoot } from "../shared/aggregate-root.ts";
import type { Clock } from "../shared/domain-event.ts";
import type { DomainResult } from "../shared/result.ts";
import { domainErr, domainOk } from "../shared/result.ts";
import {
  AiMessageAppendedEvent,
  AiMessageAdoptedEvent,
  AiSessionAbortedEvent,
  AiSessionCompletedEvent,
  AiSessionCreatedEvent,
} from "./events.ts";
import { AiMessage, type CreateMessageArgs, type MessageSnapshot } from "./message.ts";

export type AiSessionStatus = "active" | "completed" | "aborted";

export interface AiSessionSnapshot {
  id: AiSessionId;
  projectId: ProjectId | null;
  subAgentName: string | null;
  title: string;
  status: AiSessionStatus;
  createdAt: Date;
  updatedAt: Date;
  expireAt: Date | null;
  messageCount: number;
}

export interface CreateAiSessionArgs {
  projectId?: ProjectId | null;
  subAgentName?: string | null;
  title: string;
  clock: Clock;
  /** 测试用：固定 ID */
  id?: AiSessionId;
  /** 会话 TTL；默认 30 天 */
  ttlDays?: number;
}

export class AiSession extends AggregateRoot<AiSessionId> {
  private _projectId: ProjectId | null;
  private _subAgentName: string | null;
  private _title: string;
  private _status: AiSessionStatus;
  private _messages: AiMessage[];
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _expireAt: Date | null;
  /** 引用计分：助手消息被引用次数；持久化时同 messages 一起写 */
  private _citedCount: Map<string, number>;

  private constructor(
    id: AiSessionId,
    projectId: ProjectId | null,
    subAgentName: string | null,
    title: string,
    status: AiSessionStatus,
    messages: readonly AiMessage[],
    citedCount: ReadonlyMap<string, number>,
    createdAt: Date,
    updatedAt: Date,
    expireAt: Date | null,
  ) {
    super(id);
    this._projectId = projectId;
    this._subAgentName = subAgentName;
    this._title = title;
    this._status = status;
    this._messages = [...messages];
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._expireAt = expireAt;
    this._citedCount = new Map(citedCount);
  }

  // ---------- factory ----------

  static create(args: CreateAiSessionArgs): DomainResult<AiSession> {
    const title = args.title?.trim() ?? "";
    if (title.length === 0) {
      return domainErr("INVALID_INPUT", "session title is required");
    }
    if (title.length > 200) {
      return domainErr("INVALID_INPUT", "session title too long (max 200 chars)");
    }
    const now = args.clock.now();
    const ttlDays = args.ttlDays ?? 30;
    const expireAt = new Date(now.getTime() + ttlDays * 86_400_000);
    const id = args.id ?? toAiSessionId(newId<"AiSessionId">());
    const session = new AiSession(
      id,
      args.projectId ?? null,
      args.subAgentName ?? null,
      title,
      "active",
      [],
      new Map(),
      now,
      now,
      expireAt,
    );
    session.addDomainEvent(
      new AiSessionCreatedEvent(id, args.projectId ?? null, args.subAgentName ?? null, title, now),
    );
    return domainOk(session);
  }

  static rehydrate(snap: {
    id: AiSessionId;
    projectId: ProjectId | null;
    subAgentName: string | null;
    title: string;
    status: AiSessionStatus;
    messages: readonly MessageSnapshot[];
    citedCount: ReadonlyMap<string, number>;
    createdAt: Date;
    updatedAt: Date;
    expireAt: Date | null;
  }): AiSession {
    if (snap.title.trim().length === 0) {
      throw new Error(`corrupt ai-session ${snap.id}: title empty`);
    }
    return new AiSession(
      snap.id,
      snap.projectId,
      snap.subAgentName,
      snap.title,
      snap.status,
      snap.messages.map(AiMessage.rehydrate),
      snap.citedCount,
      snap.createdAt,
      snap.updatedAt,
      snap.expireAt,
    );
  }

  // ---------- getters ----------

  get projectId(): ProjectId | null {
    return this._projectId;
  }
  get subAgentName(): string | null {
    return this._subAgentName;
  }
  get titleValue(): string {
    return this._title;
  }
  get statusValue(): AiSessionStatus {
    return this._status;
  }
  get createdAtValue(): Date {
    return this._createdAt;
  }
  get updatedAtValue(): Date {
    return this._updatedAt;
  }
  get expireAtValue(): Date | null {
    return this._expireAt;
  }
  get messages(): readonly AiMessage[] {
    return this._messages;
  }

  // ---------- commands ----------

  appendMessage(args: CreateMessageArgs, clock: Clock): DomainResult<AiMessage> {
    if (this._status !== "active") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot append message to ${this._status} session`,
        { sessionStatus: this._status },
      );
    }
    // 强制注入 sessionId
    const fullArgs: CreateMessageArgs = { ...args, sessionId: this.id };
    const r = AiMessage.create(fullArgs);
    if (!r.ok) return r;

    // 引用计分：助手消息里 citedMessageIds 累加
    if (r.value.role === "assistant") {
      for (const cited of r.value.citedMessageIds) {
        this._citedCount.set(cited, (this._citedCount.get(cited) ?? 0) + 1);
      }
    }

    this._messages.push(r.value);
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(new AiMessageAppendedEvent(this.id, r.value.id, r.value.role, now));
    return domainOk(r.value);
  }

  /**
   * 用户采纳某条助手消息 → 触发 ai-session.message-adopted 事件。
   * 应用层负责把消息写进 ai_knowledge。
   */
  adopt(messageId: string, clock: Clock): DomainResult<void> {
    if (this._status !== "active") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot adopt message in ${this._status} session`,
      );
    }
    const msg = this._messages.find((m) => m.id === messageId);
    if (!msg) {
      return domainErr("NOT_FOUND", `message ${messageId} not found in session`);
    }
    if (msg.role !== "assistant") {
      return domainErr(
        "INVALID_INPUT",
        "only assistant messages can be adopted",
        { messageRole: msg.role },
      );
    }
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(new AiMessageAdoptedEvent(this.id, msg.id, now));
    return domainOk(undefined);
  }

  complete(clock: Clock): DomainResult<void> {
    if (this._status !== "active") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot complete ${this._status} session`,
      );
    }
    const now = clock.now();
    this._status = "completed";
    this._updatedAt = now;
    this.addDomainEvent(new AiSessionCompletedEvent(this.id, now));
    return domainOk(undefined);
  }

  abort(reason: string, clock: Clock): DomainResult<void> {
    if (this._status !== "active") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot abort ${this._status} session`,
      );
    }
    const now = clock.now();
    this._status = "aborted";
    this._updatedAt = now;
    this.addDomainEvent(new AiSessionAbortedEvent(this.id, reason, now));
    return domainOk(undefined);
  }

  // ---------- snapshot ----------

  snapshot(): AiSessionSnapshot {
    return {
      id: this.id,
      projectId: this._projectId,
      subAgentName: this._subAgentName,
      title: this._title,
      status: this._status,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      expireAt: this._expireAt,
      messageCount: this._messages.length,
    };
  }

  /** 给仓储用：取出全部消息快照 + 引用计数 */
  messageSnapshots(): readonly MessageSnapshot[] {
    return this._messages.map((m) => m.snapshot());
  }

  citedCountMap(): ReadonlyMap<string, number> {
    return new Map(this._citedCount);
  }
}