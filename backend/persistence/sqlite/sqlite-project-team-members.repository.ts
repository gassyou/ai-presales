/**
 * SqliteProjectTeamMembersRepository —— project_team_members 表的 SQLite 实现
 *
 * 阶段 7.4e。排序：created_at ASC。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import type {
  CreateTeamMemberArgs,
  IProjectTeamMembersRepository,
  UpdateTeamMemberArgs,
} from "@backend/domain/project/project-team-members.repository.ts";
import type { TeamMemberSnapshot } from "@backend/domain/project/project-team-members.ts";
import type { Database } from "../database/database.ts";

interface MemberRow {
  id: string;
  project_id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

function rowToSnapshot(row: MemberRow): TeamMemberSnapshot {
  return {
    id: row.id,
    projectId: toProjectId(row.project_id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteProjectTeamMembersRepository implements IProjectTeamMembersRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: ProjectId): Promise<TeamMemberSnapshot[]> {
    const rows = this.db.query<MemberRow>(
      `SELECT id, project_id, name, email, phone, created_at, updated_at
       FROM project_team_members
       WHERE project_id = ?
       ORDER BY created_at ASC`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: string): Promise<TeamMemberSnapshot | null> {
    const row = this.db.queryRow<MemberRow>(
      `SELECT id, project_id, name, email, phone, created_at, updated_at
       FROM project_team_members WHERE id = ?`,
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async create(
    args: CreateTeamMemberArgs & { createdAt: Date },
  ): Promise<DomainResult<TeamMemberSnapshot>> {
    const id = args.id ?? crypto.randomUUID();
    const now = args.createdAt;
    try {
      this.db.run(
        `INSERT INTO project_team_members
           (id, project_id, name, email, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          args.projectId,
          args.name,
          args.email ?? "",
          args.phone ?? "",
          now.toISOString(),
          now.toISOString(),
        ],
      );
      const snap = await this.findById(id);
      if (!snap) return domainErr("INTERNAL", "team member disappeared after insert");
      return domainOk(snap);
    } catch (e) {
      return domainErr(
        "INTERNAL",
        `create team member failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async update(
    id: string,
    args: UpdateTeamMemberArgs,
    updatedAt: Date,
  ): Promise<DomainResult<TeamMemberSnapshot>> {
    const existing = await this.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `team member ${id} not found`);
    const fields: string[] = [];
    const params: (string | number)[] = [];
    if (args.name !== undefined) {
      fields.push("name = ?");
      params.push(args.name);
    }
    if (args.email !== undefined) {
      fields.push("email = ?");
      params.push(args.email);
    }
    if (args.phone !== undefined) {
      fields.push("phone = ?");
      params.push(args.phone);
    }
    fields.push("updated_at = ?");
    params.push(updatedAt.toISOString());
    params.push(id);
    this.db.run(
      `UPDATE project_team_members SET ${fields.join(", ")} WHERE id = ?`,
      params,
    );
    const snap = await this.findById(id);
    if (!snap) return domainErr("INTERNAL", "team member disappeared after update");
    return domainOk(snap);
  }

  async delete(id: string): Promise<DomainResult<void>> {
    const r = this.db.run("DELETE FROM project_team_members WHERE id = ?", [id]);
    if (r.changes === 0) return domainErr("NOT_FOUND", `team member ${id} not found`);
    return domainOk(undefined);
  }
}