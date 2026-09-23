/**
 * SqliteBusinessModuleRepository —— business_module_items 表 CRUD
 *
 * 阶段 7.0：单一表容纳所有 20+ 业务模块的条目。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";
import type {
  BusinessModuleItemAcrossProjectsSnapshot,
  IBusinessModuleRepository,
  ListByKindAcrossProjectsOptions,
} from "@backend/domain/business-module/business-module.repository.ts";
import type { BusinessModuleItemSnapshot } from "@backend/domain/business-module/business-module-item.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";

interface BusinessModuleRow {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

function rowToSnapshot(row: BusinessModuleRow): BusinessModuleItemSnapshot {
  return {
    id: row.id,
    projectId: toProjectId(row.project_id),
    kind: row.kind as BusinessModuleKind,
    title: row.title,
    content: row.content,
    status: row.status as "pending" | "adopted" | "unadopted",
    payloadJson: row.payload_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SqliteBusinessModuleRepository implements IBusinessModuleRepository {
  constructor(private readonly db: Database) {}

  async save(item: BusinessModuleItemSnapshot): Promise<void> {
    this.db.run(
      `INSERT INTO business_module_items
        (id, project_id, kind, title, content, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         kind = excluded.kind,
         title = excluded.title,
         content = excluded.content,
         status = excluded.status,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      [
        item.id,
        item.projectId,
        item.kind,
        item.title,
        item.content,
        item.status,
        item.payloadJson,
        item.createdAt.toISOString(),
        item.updatedAt.toISOString(),
      ] as QueryParam[],
    );
  }

  async findById(id: string): Promise<BusinessModuleItemSnapshot | null> {
    const row = this.db.queryRow<BusinessModuleRow>(
      "SELECT * FROM business_module_items WHERE id = ?",
      [id],
    );
    return row ? rowToSnapshot(row) : null;
  }

  async listByProjectAndKind(
    projectId: ProjectId,
    kind: BusinessModuleKind,
    opts?: { status?: "pending" | "adopted" | "unadopted" },
  ): Promise<BusinessModuleItemSnapshot[]> {
    const sql = opts?.status
      ? `SELECT * FROM business_module_items
         WHERE project_id = ? AND kind = ? AND status = ?
         ORDER BY updated_at DESC`
      : `SELECT * FROM business_module_items
         WHERE project_id = ? AND kind = ?
         ORDER BY updated_at DESC`;
    const params = opts?.status
      ? [projectId, kind, opts.status]
      : [projectId, kind];
    const rows = this.db.query<BusinessModuleRow>(sql, params as QueryParam[]);
    return rows.map(rowToSnapshot);
  }

  async delete(id: string): Promise<void> {
    this.db.run("DELETE FROM business_module_items WHERE id = ?", [id]);
  }

  async countAdoptedByProjectAndKind(
    projectId: ProjectId,
    kind: BusinessModuleKind,
  ): Promise<number> {
    const row = this.db.queryRow<{ c: number }>(
      `SELECT COUNT(*) AS c FROM business_module_items
       WHERE project_id = ? AND kind = ? AND status = 'adopted'`,
      [projectId, kind],
    );
    return row?.c ?? 0;
  }

  async listByKindAcrossProjects(
    kind: BusinessModuleKind,
    opts: ListByKindAcrossProjectsOptions,
  ): Promise<BusinessModuleItemAcrossProjectsSnapshot[]> {
    const wheres: string[] = ["i.kind = ?"];
    const params: QueryParam[] = [kind];
    if (opts.status) {
      wheres.push("i.status = ?");
      params.push(opts.status);
    }
    if (opts.fromDate) {
      wheres.push("json_extract(i.payload_json, '$.planDate') >= ?");
      params.push(opts.fromDate);
    }
    if (opts.toDate) {
      wheres.push("json_extract(i.payload_json, '$.planDate') <= ?");
      params.push(opts.toDate);
    }
    const orderClause = opts.sortByPlanDate
      ? `ORDER BY json_extract(i.payload_json, '$.planDate') ${opts.sortByPlanDate === "asc" ? "ASC" : "DESC"}`
      : "ORDER BY i.updated_at DESC";
    const limitClause = opts.limit && opts.limit > 0 ? "LIMIT ?" : "";
    if (opts.limit && opts.limit > 0) params.push(opts.limit);

    const sql = `SELECT i.id, i.project_id, i.kind, i.title, i.content, i.status,
                        i.payload_json, i.created_at, i.updated_at,
                        p.name AS project_name,
                        p.client_name AS project_client_name,
                        json_extract(i.payload_json, '$.planDate') AS plan_date,
                        json_extract(i.payload_json, '$.clientContactName') AS client_contact_name
                 FROM business_module_items i
                 JOIN projects p ON p.id = i.project_id
                 WHERE ${wheres.join(" AND ")}
                 ${orderClause}
                 ${limitClause}`;
    interface AcrossRow {
      id: string;
      project_id: string;
      kind: string;
      title: string;
      content: string;
      status: string;
      payload_json: string;
      created_at: string;
      updated_at: string;
      project_name: string;
      project_client_name: string;
      plan_date: string | null;
      client_contact_name: string | null;
    }
    const rows = this.db.query<AcrossRow>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      projectId: toProjectId(r.project_id),
      kind: r.kind as BusinessModuleKind,
      title: r.title,
      content: r.content,
      status: r.status as "pending" | "adopted" | "unadopted",
      payloadJson: r.payload_json,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      projectName: r.project_name,
      clientName: r.project_client_name,
      planDate: r.plan_date,
      clientContactName: r.client_contact_name,
    }));
  }
}
