/**
 * Project 聚合根
 *
 * 字段尽量少；其余元数据（联系人 / 团队成员 / 业务编号）后续阶段扩展。
 * 状态变更走方法；事件在变更时 addDomainEvent，由仓储 commit 时 pull。
 */

import { newId, type ProjectId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import { AggregateRoot } from "../shared/aggregate-root.ts";
import type { Clock } from "../shared/domain-event.ts";
import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";
import { ClientName } from "./client-name.ts";
import {
  ProjectArchivedEvent,
  ProjectCreatedEvent,
  ProjectRenamedEvent,
  ProjectStatusChangedEvent,
} from "./events.ts";
import { ProjectName } from "./project-name.ts";
import { ProjectStatus, type ProjectStatusValue } from "./project-status.ts";

/**
 * 阶段 7.4e：snapshot 增加 contacts / teamMembers（denormalized）。
 * 聚合根内仍只保留项目本体字段；这两块由仓储层在 snapshot 组装时填入。
 * 默认空数组（保持后向兼容）；前端早已声明这两个字段为 readonly。
 *
 * 阶段 7.4g：状态切换附加字段（wonDate / lostDate / lostReason /
 * bestPractice / improvementNote / pauseReason）写入 snapshot。
 * 历史项目这些字段为 null —— 仪表盘统计会 fallback 到 updated_at 年。
 */
export interface ProjectContactView {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly email: string;
  readonly phone: string;
  readonly isPrimary: boolean;
}

export interface TeamMemberView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

export interface ProjectSnapshot {
  id: ProjectId;
  code: string;
  name: string;
  clientName: string;
  status: ProjectStatusValue;
  createdAt: Date;
  updatedAt: Date;
  readonly contacts: readonly ProjectContactView[];
  readonly teamMembers: readonly TeamMemberView[];
  /** 阶段 7.4g：状态切换附加字段 —— 全部可空 */
  readonly wonDate: Date | null;
  readonly lostDate: Date | null;
  readonly lostReason: string | null;
  readonly bestPractice: string | null;
  readonly improvementNote: string | null;
  readonly pauseReason: string | null;
}

export interface CreateProjectArgs {
  code: string;            // 业务编号（应用层生成）
  name: string;
  clientName: string;
  clock: Clock;
  /** 测试用：固定 ID（默认生成） */
  id?: ProjectId;
}

export class Project extends AggregateRoot<ProjectId> {
  private readonly _code: string;
  private _name: ProjectName;
  private _clientName: ClientName;
  private _status: ProjectStatus;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  /** 阶段 7.4g：状态切换附加字段 */
  private _wonDate: Date | null;
  private _lostDate: Date | null;
  private _lostReason: string | null;
  private _bestPractice: string | null;
  private _improvementNote: string | null;
  private _pauseReason: string | null;

  private constructor(
    id: ProjectId,
    code: string,
    name: ProjectName,
    clientName: ClientName,
    status: ProjectStatus,
    createdAt: Date,
    updatedAt: Date,
    init: {
      wonDate: Date | null;
      lostDate: Date | null;
      lostReason: string | null;
      bestPractice: string | null;
      improvementNote: string | null;
      pauseReason: string | null;
    } = {
      wonDate: null,
      lostDate: null,
      lostReason: null,
      bestPractice: null,
      improvementNote: null,
      pauseReason: null,
    },
  ) {
    super(id);
    this._code = code;
    this._name = name;
    this._clientName = clientName;
    this._status = status;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._wonDate = init.wonDate;
    this._lostDate = init.lostDate;
    this._lostReason = init.lostReason;
    this._bestPractice = init.bestPractice;
    this._improvementNote = init.improvementNote;
    this._pauseReason = init.pauseReason;
  }

  // ---------- factory ----------

  static create(args: CreateProjectArgs): DomainResult<Project> {
    const nameR = ProjectName.create(args.name);
    if (!nameR.ok) return nameR;
    const clientR = ClientName.create(args.clientName);
    if (!clientR.ok) return clientR;
    if (!args.code || args.code.trim().length === 0) {
      return domainErr("INVALID_INPUT", "project code is required");
    }
    const now = args.clock.now();
    const id = args.id ?? toProjectId(newId<"ProjectId">());
    const p = new Project(
      id,
      args.code,
      nameR.value,
      clientR.value,
      ProjectStatus.initial(),
      now,
      now,
    );
    p.addDomainEvent(new ProjectCreatedEvent(id, nameR.value.value, clientR.value.value, now));
    return domainOk(p);
  }

  /**
   * 仓储重新构造 —— 信任持久层传来的字段一致
   *
   * 不触发领域事件（事件应当由 spawn 层负责重建，或干脆丢弃历史事件）。
   *
   * 阶段 7.4g：兼容旧数据 —— 缺省字段全部视为 null（项目 009 迁移前的旧行）。
   */
  static rehydrate(snap: {
    id: ProjectId;
    code: string;
    name: string;
    clientName: string;
    status: ProjectStatusValue;
    createdAt: Date;
    updatedAt: Date;
    wonDate?: Date | null;
    lostDate?: Date | null;
    lostReason?: string | null;
    bestPractice?: string | null;
    improvementNote?: string | null;
    pauseReason?: string | null;
  }): Project {
    // 持久层应当只存合法值；这里故意 fail-fast 不再校验
    const nameR = ProjectName.create(snap.name);
    const clientR = ClientName.create(snap.clientName);
    const statusR = ProjectStatus.create(snap.status);
    if (!nameR.ok) throw new Error(`corrupt project ${snap.id}: ${nameR.error.message}`);
    if (!clientR.ok) throw new Error(`corrupt project ${snap.id}: ${clientR.error.message}`);
    if (!statusR.ok) throw new Error(`corrupt project ${snap.id}: ${statusR.error.message}`);
    return new Project(
      snap.id,
      snap.code,
      nameR.value,
      clientR.value,
      statusR.value,
      snap.createdAt,
      snap.updatedAt,
      {
        wonDate: snap.wonDate ?? null,
        lostDate: snap.lostDate ?? null,
        lostReason: snap.lostReason ?? null,
        bestPractice: snap.bestPractice ?? null,
        improvementNote: snap.improvementNote ?? null,
        pauseReason: snap.pauseReason ?? null,
      },
    );
  }

  // ---------- getters ----------

  get code(): string {
    return this._code;
  }

  get name(): string {
    return this._name.value;
  }

  get clientName(): string {
    return this._clientName.value;
  }

  get statusValue(): ProjectStatusValue {
    return this._status.value;
  }

  get createdAtValue(): Date {
    return this._createdAt;
  }

  get updatedAtValue(): Date {
    return this._updatedAt;
  }

  // ---------- commands ----------

  rename(newName: string, clock: Clock): DomainResult<void> {
    const r = ProjectName.create(newName);
    if (!r.ok) return r;
    if (r.value.equals(this._name)) {
      return domainErr("INVALID_INPUT", "new name must be different");
    }
    const from = this._name.value;
    this._name = r.value;
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(new ProjectRenamedEvent(this.id, from, this._name.value, now));
    return domainOk(undefined);
  }

  changeStatus(target: ProjectStatusValue, clock: Clock, reason?: string): DomainResult<void> {
    const r = this._status.transition(target);
    if (!r.ok) return r;
    const from = this._status.value;
    this._status = r.value;
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(
      new ProjectStatusChangedEvent(this.id, from, target, now, reason),
    );
    return domainOk(undefined);
  }

  archive(clock: Clock): DomainResult<void> {
    if (this._status.value === "中标" || this._status.value === "未中标") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        "cannot archive a closed project",
        { status: this._status.value },
      );
    }
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(new ProjectArchivedEvent(this.id, now));
    return domainOk(undefined);
  }

  // ---------- 阶段 7.4g：状态切换附加字段 ----------
  // markWon / markLost / markPaused 在状态机校验通过的前提下写入对应日期 / 原因字段。
  // 旧有 changeStatus(target, clock, reason?) 仍保留以兼容旧调用方；
  // 新流程（ProjectService.changeProjectStatus）按 target 路由到这三个方法。

  /** 标记为中标：要求当前状态为"提案中"，写入 wonDate + 可选 bestPractice */
  markWon(args: { wonDate: Date; bestPractice?: string }, clock: Clock): DomainResult<void> {
    if (this._status.value !== "提案中") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot mark project as 中标 from status "${this._status.value}"`,
        { current: this._status.value, allowed: ["提案中"] },
      );
    }
    if (!(args.wonDate instanceof Date) || isNaN(args.wonDate.getTime())) {
      return domainErr("INVALID_INPUT", "wonDate must be a valid Date");
    }
    const tr = this._status.transition("中标");
    if (!tr.ok) return tr;
    const from = this._status.value;
    this._status = tr.value;
    this._wonDate = args.wonDate;
    if (args.bestPractice !== undefined) {
      const trimmed = args.bestPractice.trim();
      this._bestPractice = trimmed.length > 0 ? trimmed : null;
    }
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(
      new ProjectStatusChangedEvent(this.id, from, "中标", now, args.bestPractice),
    );
    return domainOk(undefined);
  }

  /** 标记为未中标：接受"提案中"/"暂停"，要求 lostReason，lostDate 必填 */
  markLost(args: {
    lostDate: Date;
    lostReason: string;
    improvementNote?: string;
  }, clock: Clock): DomainResult<void> {
    if (this._status.value !== "提案中" && this._status.value !== "暂停") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot mark project as 未中标 from status "${this._status.value}"`,
        { current: this._status.value, allowed: ["提案中", "暂停"] },
      );
    }
    const reason = args.lostReason.trim();
    if (reason.length === 0) {
      return domainErr("INVALID_INPUT", "lostReason is required");
    }
    if (!(args.lostDate instanceof Date) || isNaN(args.lostDate.getTime())) {
      return domainErr("INVALID_INPUT", "lostDate must be a valid Date");
    }
    const tr = this._status.transition("未中标");
    if (!tr.ok) return tr;
    const from = this._status.value;
    this._status = tr.value;
    this._lostDate = args.lostDate;
    this._lostReason = reason;
    if (args.improvementNote !== undefined) {
      const trimmed = args.improvementNote.trim();
      this._improvementNote = trimmed.length > 0 ? trimmed : null;
    }
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(
      new ProjectStatusChangedEvent(this.id, from, "未中标", now, reason),
    );
    return domainOk(undefined);
  }

  /** 标记为暂停：要求当前状态为"提案中"，pauseReason 必填 */
  markPaused(args: { pauseReason: string }, clock: Clock): DomainResult<void> {
    if (this._status.value !== "提案中") {
      return domainErr(
        "ILLEGAL_STATE_TRANSITION",
        `cannot mark project as 暂停 from status "${this._status.value}"`,
        { current: this._status.value, allowed: ["提案中"] },
      );
    }
    const reason = args.pauseReason.trim();
    if (reason.length === 0) {
      return domainErr("INVALID_INPUT", "pauseReason is required");
    }
    const tr = this._status.transition("暂停");
    if (!tr.ok) return tr;
    const from = this._status.value;
    this._status = tr.value;
    this._pauseReason = reason;
    const now = clock.now();
    this._updatedAt = now;
    this.addDomainEvent(
      new ProjectStatusChangedEvent(this.id, from, "暂停", now, reason),
    );
    return domainOk(undefined);
  }

  // ---------- snapshot ----------

  snapshot(): ProjectSnapshot {
    return {
      id: this.id,
      code: this._code,
      name: this._name.value,
      clientName: this._clientName.value,
      status: this._status.value,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      contacts: [],
      teamMembers: [],
      wonDate: this._wonDate,
      lostDate: this._lostDate,
      lostReason: this._lostReason,
      bestPractice: this._bestPractice,
      improvementNote: this._improvementNote,
      pauseReason: this._pauseReason,
    };
  }
}