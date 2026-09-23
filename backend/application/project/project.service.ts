/**
 * ProjectService —— 应用层对 Project 聚合根的用例编排
 *
 * 用例：
 *   - createProject: 生成业务编号 + 调聚合根.create + 仓储.save
 *   - renameProject: 加载 → 改名 → 保存
 *   - changeProjectStatus: 加载 → 状态变更 → 保存
 *   - listProjects: 直接走仓储查询
 *   - getProject: 加载聚合根（返回 snapshot 给前端）
 *
 * 所有方法返回 DomainResult，让 presentation 做映射。
 *
 * 阶段 7.4e：snapshot 注入 contacts/teamMembers（denormalized）。
 * 仓储层若已注入对应 repo，会自动拼到 snapshot；service 也可注入，
 * 用于在某些路径（listProjects/getProject）做额外补齐。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import {
  Project,
  type ProjectContactView,
  type ProjectSnapshot,
  type TeamMemberView,
} from "@backend/domain/project/project.ts";
import type {
  IProjectRepository,
  ProjectListFilter,
  ProjectListResult,
} from "@backend/domain/project/project.repository.ts";
import type { ProjectStatusValue } from "@backend/domain/project/project-status.ts";
import type { IProjectContactsRepository } from "@backend/domain/project/project-contacts.repository.ts";
import type { IProjectTeamMembersRepository } from "@backend/domain/project/project-team-members.repository.ts";

export interface ProjectServiceDeps {
  repo: IProjectRepository;
  clock?: Clock;
  /** 由调用方提供当前年份；默认 clock.now().getFullYear() */
  yearProvider?: () => number;
  /** 阶段 7.4e：可选注入，做二次补齐（仓储层一般已拼好） */
  contactsRepo?: IProjectContactsRepository;
  teamRepo?: IProjectTeamMembersRepository;
}

export class ProjectService {
  private readonly repo: IProjectRepository;
  private readonly clock: Clock;
  private readonly yearProvider: () => number;
  private readonly contactsRepo?: IProjectContactsRepository;
  private readonly teamRepo?: IProjectTeamMembersRepository;

  constructor(deps: ProjectServiceDeps) {
    this.repo = deps.repo;
    this.clock = deps.clock ?? new SystemClock();
    this.yearProvider = deps.yearProvider ?? (() => this.clock.now().getFullYear());
    this.contactsRepo = deps.contactsRepo;
    this.teamRepo = deps.teamRepo;
  }

  async createProject(input: { name: string; clientName: string }): Promise<DomainResult<ProjectSnapshot>> {
    if (!input.name || input.name.trim().length === 0) {
      return domainErr("INVALID_INPUT", "name is required");
    }
    if (!input.clientName || input.clientName.trim().length === 0) {
      return domainErr("INVALID_INPUT", "clientName is required");
    }
    const year = this.yearProvider();
    const code = await this.repo.nextProjectCode(year);
    const r = Project.create({
      code,
      name: input.name,
      clientName: input.clientName,
      clock: this.clock,
    });
    if (!r.ok) return r;
    const saveR = await this.repo.save(r.value);
    if (!saveR.ok) return saveR;
    // 新建项目联系人/团队必为空
    return domainOk(r.value.snapshot());
  }

  async renameProject(id: ProjectId, newName: string): Promise<DomainResult<ProjectSnapshot>> {
    const found = await this.repo.findById(id);
    if (!found.ok) return found;
    const r = found.value.rename(newName, this.clock);
    if (!r.ok) return r;
    const saveR = await this.repo.save(found.value);
    if (!saveR.ok) return saveR;
    return domainOk(found.value.snapshot());
  }

  async changeProjectStatus(
    id: ProjectId,
    target: ProjectStatusValue,
    payload?: {
      reason?: string;
      wonDate?: Date;
      bestPractice?: string;
      lostDate?: Date;
      lostReason?: string;
      improvementNote?: string;
    },
  ): Promise<DomainResult<ProjectSnapshot>> {
    const found = await this.repo.findById(id);
    if (!found.ok) return found;
    // 阶段 7.4g：按 target 路由到 markWon/markLost/markPaused，
    // 让"中标/未中标/暂停"这些需要附加字段的状态切换走专用入口。
    // 未传必填日期时，clock.now() 兜底（保持旧调用方兼容）。
    let r: DomainResult<void>;
    switch (target) {
      case "中标":
        r = found.value.markWon({
          wonDate: payload?.wonDate ?? this.clock.now(),
          ...(payload?.bestPractice !== undefined ? { bestPractice: payload.bestPractice } : {}),
        }, this.clock);
        break;
      case "未中标": {
        const reason = payload?.lostReason ?? payload?.reason;
        if (!reason || reason.trim().length === 0) {
          return domainErr("INVALID_INPUT", "lostReason is required", { target });
        }
        r = found.value.markLost({
          lostDate: payload?.lostDate ?? this.clock.now(),
          lostReason: reason,
          ...(payload?.improvementNote !== undefined ? { improvementNote: payload.improvementNote } : {}),
        }, this.clock);
        break;
      }
      case "暂停": {
        const reason = payload?.reason;
        if (!reason || reason.trim().length === 0) {
          return domainErr("INVALID_INPUT", "pauseReason is required", { target });
        }
        r = found.value.markPaused({ pauseReason: reason }, this.clock);
        break;
      }
      default:
        // 其他状态（新建 / 提案中 / 中标 / 未中标）：无附加字段要求，走旧 changeStatus
        r = found.value.changeStatus(target, this.clock, payload?.reason);
        break;
    }
    if (!r.ok) return r;
    const saveR = await this.repo.save(found.value);
    if (!saveR.ok) return saveR;
    return domainOk(found.value.snapshot());
  }

  async getProject(id: ProjectId): Promise<DomainResult<ProjectSnapshot>> {
    const snap = await this.repo.findSnapshotById(id);
    if (!snap) return domainErr("NOT_FOUND", `project ${id} not found`);
    return domainOk(await this.enrichSnapshot(snap));
  }

  async listProjects(filter: ProjectListFilter): Promise<ProjectListResult> {
    const result = await this.repo.list(filter);
    // 仓储层可能已拼好 contacts/teamMembers；若否则补一次
    const items = await Promise.all(
      result.items.map((s) => this.enrichSnapshot(s)),
    );
    return { items, total: result.total, limit: result.limit, offset: result.offset };
  }

  async deleteProject(id: ProjectId): Promise<DomainResult<void>> {
    return await this.repo.delete(id);
  }

  private async enrichSnapshot(snap: ProjectSnapshot): Promise<ProjectSnapshot> {
    // 仓储层已拼好 → 直接返回
    if (snap.contacts.length > 0 || snap.teamMembers.length > 0) return snap;
    if (!this.contactsRepo && !this.teamRepo) return snap;
    const [contacts, team] = await Promise.all([
      this.contactsRepo ? this.contactsRepo.listByProject(snap.id) : Promise.resolve([]),
      this.teamRepo ? this.teamRepo.listByProject(snap.id) : Promise.resolve([]),
    ]);
    return {
      ...snap,
      contacts: contacts.map(toContactView),
      teamMembers: team.map(toMemberView),
    };
  }
}

function toContactView(c: {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}): ProjectContactView {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    email: c.email,
    phone: c.phone,
    isPrimary: c.isPrimary,
  };
}

function toMemberView(m: {
  id: string;
  name: string;
  email: string;
  phone: string;
}): TeamMemberView {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
  };
}