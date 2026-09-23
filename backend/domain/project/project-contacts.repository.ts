/**
 * IProjectContactsRepository —— 项目联系人仓储接口
 *
 * 阶段 7.4e。同项目仅允许 1 个 isPrimary=true（由 SQLite 唯一索引兜底）。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import type { ProjectContactSnapshot } from "./project-contacts.ts";

export interface CreateContactArgs {
  projectId: ProjectId;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  /** 测试用：固定 ID */
  id?: string;
}

export interface UpdateContactArgs {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface IProjectContactsRepository {
  listByProject(projectId: ProjectId): Promise<ProjectContactSnapshot[]>;
  findById(id: string): Promise<ProjectContactSnapshot | null>;
  create(args: CreateContactArgs & { createdAt: Date }): Promise<DomainResult<ProjectContactSnapshot>>;
  update(id: string, args: UpdateContactArgs, updatedAt: Date): Promise<DomainResult<ProjectContactSnapshot>>;
  delete(id: string): Promise<DomainResult<void>>;
}