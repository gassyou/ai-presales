/**
 * BusinessModuleItem 聚合根
 *
 * 阶段 7.0：每个业务模块的"条目"统一形态：
 *   - id / projectId / kind
 *   - title / content（markdown 类存这里；结构化类存 JSON 到 payload_json）
 *   - status（pending/adopted/unadopted）
 *   - createdAt / updatedAt
 *   - extraJson：模块特有附加数据（如活动计划的实施情况 / 调查任务的结果报告路径等）
 *
 * 设计：
 *   - 单一表 `business_module_items` 容纳所有 kind
 *   - content 字段对 markdown_* 形态是正文（用于 RAG/下载）
 *   - payload_json 字段对结构化形态是 JSON（功能列表 / 调查问卷等）
 *   - 业务模块页面 / AI 上下文装配 / 知识库 ingest 都走统一仓储
 */

import { AggregateRoot } from "../shared/aggregate-root.ts";
import type { Clock } from "../shared/domain-event.ts";
import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";
import { newId, type ProjectId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import { AdoptionStatus } from "./adoption-status.ts";
import type { BusinessModuleKind } from "./business-module.ts";

export interface BusinessModuleItemSnapshot {
  id: string;
  projectId: ProjectId;
  kind: BusinessModuleKind;
  title: string;
  content: string;
  status: "pending" | "adopted" | "unadopted";
  payloadJson: string;       // "{}" 表示无附加
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBusinessModuleItemArgs {
  projectId: ProjectId;
  kind: BusinessModuleKind;
  title: string;
  content?: string;
  status?: "pending" | "adopted" | "unadopted";
  payloadJson?: string;
  clock: Clock;
  id?: string;
}

export interface UpdateBusinessModuleItemArgs {
  title?: string;
  content?: string;
  payloadJson?: string;
  status?: "pending" | "adopted" | "unadopted";
}

export class BusinessModuleItem extends AggregateRoot<string> {
  private _title: string;
  private _content: string;
  private _status: AdoptionStatus;
  private _payloadJson: string;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private readonly _projectId: ProjectId;
  private readonly _kind: BusinessModuleKind;

  private constructor(args: {
    id: string;
    projectId: ProjectId;
    kind: BusinessModuleKind;
    title: string;
    content: string;
    status: AdoptionStatus;
    payloadJson: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    super(args.id);
    this._projectId = args.projectId;
    this._kind = args.kind;
    this._title = args.title;
    this._content = args.content;
    this._status = args.status;
    this._payloadJson = args.payloadJson;
    this._createdAt = args.createdAt;
    this._updatedAt = args.updatedAt;
  }

  // ---------- factory ----------

  static create(args: CreateBusinessModuleItemArgs): DomainResult<BusinessModuleItem> {
    const title = args.title.trim();
    if (title.length === 0) {
      return domainErr("INVALID_INPUT", "title is required");
    }
    if (title.length > 200) {
      return domainErr("INVALID_INPUT", "title too long (max 200)");
    }
    const statusR = AdoptionStatus.create(args.status ?? "pending");
    if (!statusR.ok) return statusR;
    const now = args.clock.now();
    return domainOk(new BusinessModuleItem({
      id: args.id ?? newId<"BusinessModuleItemId">(),
      projectId: args.projectId,
      kind: args.kind,
      title,
      content: args.content ?? "",
      status: statusR.value,
      payloadJson: args.payloadJson ?? "{}",
      createdAt: now,
      updatedAt: now,
    }));
  }

  static rehydrate(snap: BusinessModuleItemSnapshot): BusinessModuleItem {
    const statusR = AdoptionStatus.create(snap.status);
    if (!statusR.ok) {
      throw new Error(`corrupt business module item ${snap.id}: ${statusR.error.message}`);
    }
    return new BusinessModuleItem({
      id: snap.id,
      projectId: snap.projectId,
      kind: snap.kind,
      title: snap.title,
      content: snap.content,
      status: statusR.value,
      payloadJson: snap.payloadJson,
      createdAt: snap.createdAt,
      updatedAt: snap.updatedAt,
    });
  }

  // ---------- getters ----------

  get projectId(): ProjectId {
    return this._projectId;
  }

  get kind(): BusinessModuleKind {
    return this._kind;
  }

  get title(): string {
    return this._title;
  }

  get content(): string {
    return this._content;
  }

  get status(): "pending" | "adopted" | "unadopted" {
    return this._status.value;
  }

  get payloadJson(): string {
    return this._payloadJson;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // ---------- commands ----------

  update(args: UpdateBusinessModuleItemArgs, clock: Clock): DomainResult<void> {
    if (args.title !== undefined) {
      const t = args.title.trim();
      if (t.length === 0) return domainErr("INVALID_INPUT", "title cannot be empty");
      if (t.length > 200) return domainErr("INVALID_INPUT", "title too long (max 200)");
      this._title = t;
    }
    if (args.content !== undefined) this._content = args.content;
    if (args.payloadJson !== undefined) this._payloadJson = args.payloadJson;
    if (args.status !== undefined) {
      const sR = AdoptionStatus.create(args.status);
      if (!sR.ok) return sR;
      this._status = sR.value;
    }
    this._updatedAt = clock.now();
    return domainOk(undefined);
  }

  adopt(clock: Clock): DomainResult<void> {
    if (this._status.value === "adopted") return domainOk(undefined);
    const r = AdoptionStatus.create("adopted");
    if (!r.ok) return r;
    this._status = r.value;
    this._updatedAt = clock.now();
    return domainOk(undefined);
  }

  unadopt(clock: Clock): DomainResult<void> {
    if (this._status.value === "unadopted") return domainOk(undefined);
    const r = AdoptionStatus.create("unadopted");
    if (!r.ok) return r;
    this._status = r.value;
    this._updatedAt = clock.now();
    return domainOk(undefined);
  }

  // ---------- snapshot ----------

  snapshot(): BusinessModuleItemSnapshot {
    return {
      id: this.id,
      projectId: this._projectId,
      kind: this._kind,
      title: this._title,
      content: this._content,
      status: this._status.value,
      payloadJson: this._payloadJson,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
