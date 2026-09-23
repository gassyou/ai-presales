/**
 * SqliteProjectRepository —— projects 表的 SQLite 实现
 *
 * 设计：
 *   - save() 走 withTransaction，保证聚合根 = 一个事务
 *   - findById 用 Project.rehydrate() 重建
 *   - findSnapshotById 直读 row，避免构造聚合根
 *   - list 支持 status/search 过滤 + 分页
 *   - delete 是硬删除（归档走业务状态 archive()）
 *   - nextProjectCode 在事务内递增计数器，跨年重置
 *
 * 阶段 7.4e：snapshot 增加 contacts / teamMembers（denormalized）。
 * 注入可选的 contactsRepo / teamRepo，list/findById/findSnapshotById/findByMentionToken
 * 时拉一次并 merge 进 snapshot。注入缺省时返回空数组（保持后向兼容）。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";
import type {
  IProjectRepository,
  MonthlyStatRow,
  ProjectListFilter,
  ProjectListResult,
} from "@backend/domain/project/project.repository.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import { Project, type ProjectSnapshot } from "@backend/domain/project/project.ts";
import type { ProjectStatusValue } from "@backend/domain/project/project-status.ts";
import type { IProjectContactsRepository } from "@backend/domain/project/project-contacts.repository.ts";
import type { IProjectTeamMembersRepository } from "@backend/domain/project/project-team-members.repository.ts";

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  client_name: string;
  status: string;
  created_at: string;
  updated_at: string;
  won_date: string | null;
  lost_date: string | null;
  lost_reason: string | null;
  best_practice: string | null;
  improvement_note: string | null;
  pause_reason: string | null;
}

/** SELECT 列表 —— 所有查询都返回全 13 列，避免多次维护。 */
const SELECT_COLUMNS =
  "id, code, name, client_name, status, created_at, updated_at, " +
  "won_date, lost_date, lost_reason, best_practice, improvement_note, pause_reason";

function baseRowToSnapshot(row: ProjectRow): ProjectSnapshot {
  return {
    id: toProjectId(row.id),
    code: row.code,
    name: row.name,
    clientName: row.client_name,
    status: row.status as ProjectStatusValue,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    contacts: [],
    teamMembers: [],
    wonDate: row.won_date ? new Date(row.won_date) : null,
    lostDate: row.lost_date ? new Date(row.lost_date) : null,
    lostReason: row.lost_reason,
    bestPractice: row.best_practice,
    improvementNote: row.improvement_note,
    pauseReason: row.pause_reason,
  };
}

export class SqliteProjectRepository implements IProjectRepository {
  constructor(
    private readonly db: Database,
    private readonly contactsRepo?: IProjectContactsRepository,
    private readonly teamRepo?: IProjectTeamMembersRepository,
  ) {}

  async save(project: Project): Promise<DomainResult<void>> {
    const snap = project.snapshot();
    try {
      this.db.withTransaction(() => {
        this.db.run(
          `INSERT INTO projects (
             id, code, name, client_name, status, created_at, updated_at,
             won_date, lost_date, lost_reason, best_practice, improvement_note, pause_reason
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             code = excluded.code,
             name = excluded.name,
             client_name = excluded.client_name,
             status = excluded.status,
             updated_at = excluded.updated_at,
             won_date = excluded.won_date,
             lost_date = excluded.lost_date,
             lost_reason = excluded.lost_reason,
             best_practice = excluded.best_practice,
             improvement_note = excluded.improvement_note,
             pause_reason = excluded.pause_reason`,
          [
            snap.id,
            snap.code,
            snap.name,
            snap.clientName,
            snap.status,
            snap.createdAt.toISOString(),
            snap.updatedAt.toISOString(),
            snap.wonDate ? snap.wonDate.toISOString() : null,
            snap.lostDate ? snap.lostDate.toISOString() : null,
            snap.lostReason,
            snap.bestPractice,
            snap.improvementNote,
            snap.pauseReason,
          ] as QueryParam[],
        );
        // 丢弃 pending events —— 由调用方（UnitOfWork / handler）来 dispatch
        project.pullDomainEvents();
      });
      return domainOk(undefined);
    } catch (e) {
      return domainErr("INTERNAL", `save project failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async findById(id: ProjectId): Promise<DomainResult<Project>> {
    const snap = await this.findSnapshotById(id);
    if (!snap) return domainErr("NOT_FOUND", `project ${id} not found`);
    return domainOk(Project.rehydrate({
      id: snap.id,
      code: snap.code,
      name: snap.name,
      clientName: snap.clientName,
      status: snap.status,
      createdAt: snap.createdAt,
      updatedAt: snap.updatedAt,
    }));
  }

  async findSnapshotById(id: ProjectId): Promise<ProjectSnapshot | null> {
    const row = this.db.queryRow<ProjectRow>(
      `SELECT ${SELECT_COLUMNS} FROM projects WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    return await this.enrichSnapshot(baseRowToSnapshot(row));
  }

  async list(filter: ProjectListFilter): Promise<ProjectListResult> {
    const where: string[] = [];
    const params: QueryParam[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.search && filter.search.trim().length > 0) {
      where.push("(name LIKE ? OR client_name LIKE ? OR code LIKE ?)");
      const q = `%${filter.search.trim()}%`;
      params.push(q, q, q);
    }
    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const totalRow = this.db.queryRow<{ c: number }>(
      `SELECT COUNT(*) AS c FROM projects ${whereClause}`,
      params,
    );
    const total = totalRow?.c ?? 0;

    const rows = this.db.query<ProjectRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM projects ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    const items = await Promise.all(
      rows.map((r) => this.enrichSnapshot(baseRowToSnapshot(r))),
    );
    return {
      items,
      total,
      limit: filter.limit,
      offset: filter.offset,
    };
  }

  async delete(id: ProjectId): Promise<DomainResult<void>> {
    const r = this.db.run("DELETE FROM projects WHERE id = ?", [id]);
    if (r.changes === 0) {
      return domainErr("NOT_FOUND", `project ${id} not found`);
    }
    return domainOk(undefined);
  }

  async findByMentionToken(token: string): Promise<ProjectSnapshot | null> {
    if (!token || token.trim().length === 0) return null;
    const t = token.trim();
    // 1. 精确匹配 code（最高优先级）
    let row = this.db.queryRow<ProjectRow>(
      `SELECT ${SELECT_COLUMNS} FROM projects WHERE code = ?`,
      [t],
    );
    if (row) return await this.enrichSnapshot(baseRowToSnapshot(row));
    // 2. 精确匹配 name
    row = this.db.queryRow<ProjectRow>(
      `SELECT ${SELECT_COLUMNS} FROM projects WHERE name = ?`,
      [t],
    );
    if (row) return await this.enrichSnapshot(baseRowToSnapshot(row));
    // 3. LIKE 模糊匹配 code/name 任一
    const q = `%${t}%`;
    row = this.db.queryRow<ProjectRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM projects
       WHERE code LIKE ? OR name LIKE ?
       ORDER BY
         CASE WHEN code = ? THEN 0 WHEN name = ? THEN 1 WHEN code LIKE ? THEN 2 ELSE 3 END,
         updated_at DESC
       LIMIT 1`,
      [q, q, t, t, `${t}%`],
    );
    return row ? await this.enrichSnapshot(baseRowToSnapshot(row)) : null;
  }

  async nextProjectCode(year: number): Promise<string> {
    let next = 1;
    this.db.withTransaction(() => {
      const row = this.db.queryRow<{ last_value: number }>(
        "SELECT last_value FROM project_code_counters WHERE year = ?",
        [year],
      );
      next = (row?.last_value ?? 0) + 1;
      this.db.run(
        `INSERT INTO project_code_counters (year, last_value) VALUES (?, ?)
         ON CONFLICT(year) DO UPDATE SET last_value = excluded.last_value`,
        [year, next],
      );
    });
    return `${year}-${String(next).padStart(5, "0")}`;
  }

  /** 阶段 7.4e：把 contacts / teamMembers 拼到 snapshot */
  private async enrichSnapshot(snap: ProjectSnapshot): Promise<ProjectSnapshot> {
    if (!this.contactsRepo && !this.teamRepo) return snap;
    const [contacts, team] = await Promise.all([
      this.contactsRepo ? this.contactsRepo.listByProject(snap.id) : Promise.resolve([]),
      this.teamRepo ? this.teamRepo.listByProject(snap.id) : Promise.resolve([]),
    ]);
    return {
      ...snap,
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
      })),
      teamMembers: team.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
      })),
    };
  }

  // ---------- 阶段 7.4g：仪表盘聚合 ----------

  async countAll(): Promise<number> {
    const row = this.db.queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM projects",
    );
    return row?.c ?? 0;
  }

  async countCreatedBetween(from: Date, to: Date): Promise<number> {
    const row = this.db.queryRow<{ c: number }>(
      `SELECT COUNT(*) AS c FROM projects
       WHERE created_at >= ? AND created_at < ?`,
      [from.toISOString(), to.toISOString()],
    );
    return row?.c ?? 0;
  }

  async countByStatusInRange(
    status: ProjectStatusValue,
    from: Date,
    to: Date,
  ): Promise<number> {
    // 中标 / 未中标 → 用 won_date / lost_date 落在区间内计数；
    // date 为 NULL 时按 updated_at 年 fallback（兼容 009 迁移前的旧数据）。
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    if (status === "中标") {
      const row = this.db.queryRow<{ c: number }>(
        `SELECT COUNT(*) AS c FROM projects
         WHERE status = ?
           AND (
             (won_date IS NOT NULL AND won_date >= ? AND won_date < ?)
             OR (won_date IS NULL AND updated_at >= ? AND updated_at < ?)
           )`,
        [status, fromIso, toIso, fromIso, toIso],
      );
      return row?.c ?? 0;
    }
    if (status === "未中标") {
      const row = this.db.queryRow<{ c: number }>(
        `SELECT COUNT(*) AS c FROM projects
         WHERE status = ?
           AND (
             (lost_date IS NOT NULL AND lost_date >= ? AND lost_date < ?)
             OR (lost_date IS NULL AND updated_at >= ? AND updated_at < ?)
           )`,
        [status, fromIso, toIso, fromIso, toIso],
      );
      return row?.c ?? 0;
    }
    // 其他状态（新建 / 提案中 / 暂停）：直接按 status + updated_at 区间
    const row = this.db.queryRow<{ c: number }>(
      `SELECT COUNT(*) AS c FROM projects
       WHERE status = ? AND updated_at >= ? AND updated_at < ?`,
      [status, fromIso, toIso],
    );
    return row?.c ?? 0;
  }

  async monthlyStats(year: number): Promise<MonthlyStatRow[]> {
    // 用 SQL 生成 12 行（months 1..12），LEFT JOIN 三个聚合。
    // 月份桶用 strftime('%Y-%m', date) = '<year>-MM' 匹配。
    const yearPrefix = `${year}-`;
    const rows = this.db.query<MonthlyStatRow>(
      `WITH months(m) AS (
         VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)
       )
       SELECT
         m AS month,
         COALESCE(SUM(CASE WHEN p.created_at LIKE ? || printf('%02d', m) || '%' THEN 1 ELSE 0 END), 0) AS created,
         COALESCE(SUM(CASE WHEN p.status = '中标' AND (
           (p.won_date IS NOT NULL AND p.won_date LIKE ? || printf('%02d', m) || '%')
           OR (p.won_date IS NULL AND p.updated_at LIKE ? || printf('%02d', m) || '%')
         ) THEN 1 ELSE 0 END), 0) AS won,
         COALESCE(SUM(CASE WHEN p.status = '未中标' AND (
           (p.lost_date IS NOT NULL AND p.lost_date LIKE ? || printf('%02d', m) || '%')
           OR (p.lost_date IS NULL AND p.updated_at LIKE ? || printf('%02d', m) || '%')
         ) THEN 1 ELSE 0 END), 0) AS lost
       FROM months
       LEFT JOIN projects p ON 1=1
       GROUP BY m
       ORDER BY m`,
      [yearPrefix, yearPrefix, yearPrefix, yearPrefix, yearPrefix],
    );
    // node:sqlite 可能把 month 字段读成 string —— 强制转 number
    return rows.map((r) => ({
      month: Number(r.month),
      created: Number(r.created),
      won: Number(r.won),
      lost: Number(r.lost),
    }));
  }
}