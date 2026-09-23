/**
 * Project 领域事件
 *
 * 事件名用 kebab-case 便于序列化；payload 用 readonly 字段。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { ProjectStatusValue } from "./project-status.ts";
import { DomainEvent } from "../shared/domain-event.ts";

export class ProjectCreatedEvent extends DomainEvent {
  readonly eventName = "project.created";
  readonly name: string;
  readonly clientName: string;

  constructor(id: ProjectId, name: string, clientName: string, occurredAt: Date) {
    super(id, occurredAt);
    this.name = name;
    this.clientName = clientName;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      name: this.name,
      clientName: this.clientName,
    };
  }
}

export class ProjectRenamedEvent extends DomainEvent {
  readonly eventName = "project.renamed";
  readonly from: string;
  readonly to: string;

  constructor(id: ProjectId, from: string, to: string, occurredAt: Date) {
    super(id, occurredAt);
    this.from = from;
    this.to = to;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      from: this.from,
      to: this.to,
    };
  }
}

export class ProjectStatusChangedEvent extends DomainEvent {
  readonly eventName = "project.status-changed";
  readonly from: ProjectStatusValue;
  readonly to: ProjectStatusValue;
  readonly reason?: string;

  constructor(id: ProjectId, from: ProjectStatusValue, to: ProjectStatusValue, occurredAt: Date, reason?: string) {
    super(id, occurredAt);
    this.from = from;
    this.to = to;
    this.reason = reason;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      from: this.from,
      to: this.to,
      reason: this.reason,
    };
  }
}

export class ProjectArchivedEvent extends DomainEvent {
  readonly eventName = "project.archived";
  constructor(id: ProjectId, occurredAt: Date) {
    super(id, occurredAt);
  }
}