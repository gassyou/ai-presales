/**
 * AiSession 领域事件
 *
 * 命名：ai-session.<verb>
 *  - ai-session.created         新会话
 *  - ai-session.message-added   新消息（任意角色）
 *  - ai-session.completed       主动完结
 *  - ai-session.aborted         异常终止
 *  - ai-session.message-cited   用户采纳了某条助手消息（被引用计分）
 */

import type { AiSessionId, MessageId, ProjectId } from "@shared/types/ids.ts";
import { DomainEvent } from "../shared/domain-event.ts";

export class AiSessionCreatedEvent extends DomainEvent {
  readonly eventName = "ai-session.created";
  readonly projectId: ProjectId | null;
  readonly subAgentName: string | null;
  readonly title: string;
  constructor(
    id: AiSessionId,
    projectId: ProjectId | null,
    subAgentName: string | null,
    title: string,
    occurredAt: Date,
  ) {
    super(id, occurredAt);
    this.projectId = projectId;
    this.subAgentName = subAgentName;
    this.title = title;
  }
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      projectId: this.projectId,
      subAgentName: this.subAgentName,
      title: this.title,
    };
  }
}

export class AiMessageAppendedEvent extends DomainEvent {
  readonly eventName = "ai-session.message-added";
  readonly messageId: MessageId;
  readonly role: string;
  constructor(id: AiSessionId, messageId: MessageId, role: string, occurredAt: Date) {
    super(id, occurredAt);
    this.messageId = messageId;
    this.role = role;
  }
  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), messageId: this.messageId, role: this.role };
  }
}

export class AiMessageAdoptedEvent extends DomainEvent {
  readonly eventName = "ai-session.message-adopted";
  readonly messageId: MessageId;
  constructor(id: AiSessionId, messageId: MessageId, occurredAt: Date) {
    super(id, occurredAt);
    this.messageId = messageId;
  }
  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), messageId: this.messageId };
  }
}

export class AiSessionCompletedEvent extends DomainEvent {
  readonly eventName = "ai-session.completed";
  constructor(id: AiSessionId, occurredAt: Date) {
    super(id, occurredAt);
  }
}

export class AiSessionAbortedEvent extends DomainEvent {
  readonly eventName = "ai-session.aborted";
  readonly reason: string;
  constructor(id: AiSessionId, reason: string, occurredAt: Date) {
    super(id, occurredAt);
    this.reason = reason;
  }
  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), reason: this.reason };
  }
}