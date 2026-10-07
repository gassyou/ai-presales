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
import { type Clock, SystemClock } from "@backend/domain/shared/clock.ts";
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
  /** 阶段 2：工作区 mkdirSync 用的文件系统抽象（测试可注入）。默认 = real Deno.mkdir */
  workspaceFs?: WorkspaceFs;
}

/** 工作区文件系统抽象 —— 仅暴露 setWorkspace 用到的 mkdir + stat */
export interface WorkspaceFs {
  mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
  stat(path: string): Promise<{ isDirectory: boolean }>;
}

export class ProjectService {
  private readonly repo: IProjectRepository;
  private readonly clock: Clock;
  private readonly yearProvider: () => number;
  private readonly contactsRepo?: IProjectContactsRepository;
  private readonly teamRepo?: IProjectTeamMembersRepository;
  private readonly workspaceFs: WorkspaceFs;

  constructor(deps: ProjectServiceDeps) {
    this.repo = deps.repo;
    this.clock = deps.clock ?? new SystemClock();
    this.yearProvider = deps.yearProvider ?? (() => this.clock.now().getFullYear());
    this.contactsRepo = deps.contactsRepo;
    this.teamRepo = deps.teamRepo;
    // 阶段 2：默认用真 Deno FS；测试可注入 mock
    this.workspaceFs = deps.workspaceFs ?? {
      mkdir: (path, opts) => Deno.mkdir(path, opts),
      stat: async (path) => {
        try {
          const s = await Deno.stat(path);
          return { isDirectory: s.isDirectory };
        } catch {
          return { isDirectory: false };
        }
      },
    };
  }

  async createProject(
    input: {
      name: string;
      clientName: string;
      clientWebsite?: string;
      clientIntro?: string;
      projectIntro?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<DomainResult<ProjectSnapshot>> {
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
      clientWebsite: input.clientWebsite,
      clientIntro: input.clientIntro,
      projectIntro: input.projectIntro,
      startDate: input.startDate,
      endDate: input.endDate,
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

  /**
   * 阶段 7.5：原子更新项目元信息。
   *
   * 任意字段不传 / undefined = 保持原值；传 null = 清空；传字符串 = trim 后写入；
   * Date 校验 + end<start 校验在聚合根内完成。
   *
   * 改 name / clientName 走专用命令；其余字段走 updateProfile 一次原子写。
   */
  async updateProjectProfile(
    id: ProjectId,
    input: {
      name?: string;
      clientName?: string;
      clientWebsite?: string | null;
      clientIntro?: string | null;
      projectIntro?: string | null;
      startDate?: Date | null;
      endDate?: Date | null;
    },
  ): Promise<DomainResult<ProjectSnapshot>> {
    const found = await this.repo.findById(id);
    if (!found.ok) return found;
    if (input.name !== undefined) {
      const r = found.value.rename(input.name, this.clock);
      if (!r.ok) return r;
    }
    if (input.clientName !== undefined) {
      const r = found.value.changeClientName(input.clientName, this.clock);
      if (!r.ok) return r;
    }
    // 其余字段统一走 updateProfile，单独传 Date | null 的语义
    const profileArgs: {
      clientWebsite?: string | null;
      clientIntro?: string | null;
      projectIntro?: string | null;
      startDate?: Date | null;
      endDate?: Date | null;
    } = {};
    if (input.clientWebsite !== undefined) profileArgs.clientWebsite = input.clientWebsite;
    if (input.clientIntro !== undefined) profileArgs.clientIntro = input.clientIntro;
    if (input.projectIntro !== undefined) profileArgs.projectIntro = input.projectIntro;
    if (input.startDate !== undefined) profileArgs.startDate = input.startDate;
    if (input.endDate !== undefined) profileArgs.endDate = input.endDate;
    if (Object.keys(profileArgs).length > 0) {
      const r = found.value.updateProfile(profileArgs, this.clock);
      if (!r.ok) return r;
    }
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
      /** "暂停"时必填 */
      pausedDate?: Date;
    },
  ): Promise<DomainResult<ProjectSnapshot>> {
    const found = await this.repo.findById(id);
    if (!found.ok) return found;
    // 按 target 路由到 markWon/markLost/markPaused，
    // 让"中标/未中标/暂停"这些需要附加字段的状态切换走专用入口。
    // 未传必填日期时，clock.now() 兜底（保持旧调用方兼容）。
    let r: DomainResult<void>;
    switch (target) {
      case "中标": {
        if (!payload?.bestPractice || payload.bestPractice.trim().length === 0) {
          return domainErr("INVALID_INPUT", "bestPractice is required", { target });
        }
        r = found.value.markWon({
          wonDate: payload?.wonDate ?? this.clock.now(),
          bestPractice: payload.bestPractice,
        }, this.clock);
        break;
      }
      case "未中标": {
        const reason = payload?.lostReason ?? payload?.reason;
        if (!reason || reason.trim().length === 0) {
          return domainErr("INVALID_INPUT", "lostReason is required", { target });
        }
        if (!payload?.improvementNote || payload.improvementNote.trim().length === 0) {
          return domainErr("INVALID_INPUT", "improvementNote is required", { target });
        }
        r = found.value.markLost({
          lostDate: payload?.lostDate ?? this.clock.now(),
          lostReason: reason,
          improvementNote: payload.improvementNote,
        }, this.clock);
        break;
      }
      case "暂停": {
        const reason = payload?.reason;
        if (!reason || reason.trim().length === 0) {
          return domainErr("INVALID_INPUT", "pauseReason is required", { target });
        }
        if (!payload?.pausedDate) {
          return domainErr("INVALID_INPUT", "pausedDate is required", { target });
        }
        r = found.value.markPaused({ pauseReason: reason, pausedDate: payload.pausedDate }, this.clock);
        break;
      }
      default:
        // 其他状态（新建 / 提案中）：无附加字段要求，走旧 changeStatus
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

  // ---------- 阶段 2：项目工作区 ----------

  /**
   * 设置项目工作区路径。行为：
   *   - workspacePath 为 null → 清空（fallback 到默认）
   *   - workspacePath 非空 → 校验为绝对路径后持久化
   * 不实际创建目录；如需创建调 ensureWorkspace。
   */
  async setWorkspace(
    id: ProjectId,
    workspacePath: string | null,
  ): Promise<DomainResult<ProjectSnapshot>> {
    const found = await this.repo.findById(id);
    if (!found.ok) return found;
    const r = found.value.setWorkspace(workspacePath, this.clock);
    if (!r.ok) return r;
    const saveR = await this.repo.save(found.value);
    if (!saveR.ok) return saveR;
    return domainOk(found.value.snapshot());
  }

  /**
   * 解析项目当前的工作区路径（用户设置过 → 用用户的；
   * 未设置 → 走默认策略 ~/Desktop/<projectCode>）。
   * 纯计算，不写库也不创建文件。
   */
  resolveWorkspacePath(id: ProjectId, homeDir?: string): Promise<DomainResult<string>> {
    return this.repo.findById(id).then((found) => {
      if (!found.ok) return found;
      return domainOk(found.value.resolveWorkspacePath(homeDir));
    });
  }

  /**
   * 一键创建工作区：若路径不存在则 mkdir(recursive: true)，
   * 已存在则不动。返回最终路径 + created(bool) 让前端区分。
   * @param opts.workspacePath 可选：要写入的具体绝对路径；缺省 = 用项目自带或默认 (~/Desktop/<code>)
   */
  async ensureWorkspace(
    id: ProjectId,
    opts?: {
      createIfMissing?: boolean;
      homeDir?: string;
      workspacePath?: string | null;
    },
  ): Promise<DomainResult<{ path: string; created: boolean; existed: boolean }>> {
    const found = await this.repo.findById(id);
    if (!found.ok) return found;

    // 如果传了 workspacePath，先 setWorkspace（不创建）让项目落库该路径
    let targetPath: string;
    if (opts?.workspacePath) {
      // 先 setWorkspace 落库（让后续 resolve 用新值）
      const setR = found.value.setWorkspace(opts.workspacePath, this.clock);
      if (!setR.ok) return setR;
      await this.repo.save(found.value);
      targetPath = opts.workspacePath;
    } else {
      targetPath = found.value.resolveWorkspacePath(opts?.homeDir);
    }

    // 检查路径是否已存在
    const stat = await this.workspaceFs.stat(targetPath);
    if (stat.isDirectory) {
      return domainOk({ path: targetPath, created: false, existed: true });
    }
    if (opts?.createIfMissing === false) {
      return domainErr(
        "WORKSPACE_NOT_EXISTS",
        `workspace path does not exist: ${targetPath}`,
        { path: targetPath },
      );
    }
    // 用户要求"可以一键创建"——默认创建
    try {
      await this.workspaceFs.mkdir(targetPath, { recursive: true });
    } catch (e) {
      return domainErr(
        "WORKSPACE_CREATE_FAILED",
        e instanceof Error ? e.message : String(e),
        { path: targetPath },
      );
    }
    // 如果上面没 setWorkspace 落库（默认路径场景），这里落
    if (!opts?.workspacePath) {
      const setR = found.value.setWorkspace(targetPath, this.clock);
      if (setR.ok) {
        await this.repo.save(found.value);
      }
    }
    return domainOk({ path: targetPath, created: true, existed: false });
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