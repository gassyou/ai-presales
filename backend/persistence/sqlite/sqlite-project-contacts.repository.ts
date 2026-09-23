/**
 * SqliteProjectContactsRepository —— project_contacts 表的 SQLite 实现
 *
 * 阶段 7.4e。
 *
 * - isPrimary 唯一性：DB 唯一索引 `idx_project_contacts_primary` 兜底；
 *   写冲突时 SQLite 抛 SQLITE_CONSTRAINT，捕获并映射为 CONFLICT。
 * - 排序：isPrimary DESC, created_at ASC
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import type {
  CreateContactArgs,
  IProjectContactsRepository,
  UpdateContactArgs,
} from "@backend/domain/project/project-contacts.repository.ts";
import type { ProjectContactSnapshot } from "@backend/domain/project/project-contacts.ts";
import type { Database } from "../database/database.ts";

interface ContactRow {
  id: string;
  project_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

function rowToSnapshot(row: ContactRow): ProjectContactSnapshot {
  return {
    id: row.id,
    projectId: toProjectId(row.project_id),
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteProjectContactsRepository implements IProjectContactsRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: ProjectId): Promise<ProjectContactSnapshot[]> {
    const rows = this.db.query<ContactRow>(
      `SELECT id, project_id, name, title, email, phone, is_primary, created_at, updated_at
       FROM project_contacts
       WHERE project_id = ?
       ORDER BY is_primary DESC, created_at ASC`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: string): Promise<ProjectContactSnapshot | null> {
    const row = this.db.queryRow<ContactRow>(
      `SELECT id, project_id, name, title, email, phone, is_primary, created_at, updated_at
       FROM project_contacts WHERE id = ?`,
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async create(
    args: CreateContactArgs & { createdAt: Date },
  ): Promise<DomainResult<ProjectContactSnapshot>> {
    const id = args.id ?? crypto.randomUUID();
    const now = args.createdAt;
    try {
      // 若设为 primary，先清掉该项目其它 primary（应用层一致性 + DB 唯一索引兜底）
      this.db.withTransaction(() => {
        if (args.isPrimary === true) {
          this.db.run(
            `UPDATE project_contacts SET is_primary = 0, updated_at = ?
             WHERE project_id = ? AND is_primary = 1`,
            [now.toISOString(), args.projectId],
          );
        }
        this.db.run(
          `INSERT INTO project_contacts
             (id, project_id, name, title, email, phone, is_primary, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            args.projectId,
            args.name,
            args.title ?? "",
            args.email ?? "",
            args.phone ?? "",
            args.isPrimary ? 1 : 0,
            now.toISOString(),
            now.toISOString(),
          ],
        );
      });
      const snap = await this.findById(id);
      if (!snap) return domainErr("INTERNAL", "contact disappeared after insert");
      return domainOk(snap);
    } catch (e) {
      return domainErr(
        "CONFLICT",
          `create contact failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async update(
    id: string,
    args: UpdateContactArgs,
    updatedAt: Date,
  ): Promise<DomainResult<ProjectContactSnapshot>> {
    const existing = await this.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `contact ${id} not found`);
    try {
      this.db.withTransaction(() => {
        if (args.isPrimary === true) {
          this.db.run(
            `UPDATE project_contacts SET is_primary = 0, updated_at = ?
             WHERE project_id = ? AND is_primary = 1 AND id != ?`,
            [updatedAt.toISOString(), existing.projectId, id],
          );
        }
        const fields: string[] = [];
        const params: (string | number)[] = [];
        if (args.name !== undefined) {
          fields.push("name = ?");
          params.push(args.name);
        }
        if (args.title !== undefined) {
          fields.push("title = ?");
          params.push(args.title);
        }
        if (args.email !== undefined) {
          fields.push("email = ?");
          params.push(args.email);
        }
        if (args.phone !== undefined) {
          fields.push("phone = ?");
          params.push(args.phone);
        }
        if (args.isPrimary !== undefined) {
          fields.push("is_primary = ?");
          params.push(args.isPrimary ? 1 : 0);
        }
        fields.push("updated_at = ?");
        params.push(updatedAt.toISOString());
        params.push(id);
        this.db.run(
          `UPDATE project_contacts SET ${fields.join(", ")} WHERE id = ?`,
          params,
        );
      });
      const snap = await this.findById(id);
      if (!snap) return domainErr("INTERNAL", "contact disappeared after update");
      return domainOk(snap);
    } catch (e) {
      return domainErr(
        "CONFLICT",
          `update contact failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async delete(id: string): Promise<DomainResult<void>> {
    const r = this.db.run("DELETE FROM project_contacts WHERE id = ?", [id]);
    if (r.changes === 0) return domainErr("NOT_FOUND", `contact ${id} not found`);
    return domainOk(undefined);
  }
}