/**
 * DashboardUseCase 单元测试（阶段 7.4g）
 *
 * 用 fake repo（in-memory）覆盖：
 *   - getSummary 三张 KPI + 数据截止时间
 *   - getMonthlyStats 12 行 + 桶对齐
 *   - getUpcomingActivities pending + planDate >= today 过滤
 *   - getUpcomingActivities limit + ASC + 跨项目 join 字段
 */

import { assert, assertEquals } from "@std/assert";
import { newId, type ProjectId, ProjectId as toProjectId } from "@shared/types/ids.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { Project, type ProjectSnapshot } from "@backend/domain/project/project.ts";
import type {
  IProjectRepository,
  MonthlyStatRow,
  ProjectListResult,
} from "@backend/domain/project/project.repository.ts";
import type {
  BusinessModuleItemAcrossProjectsSnapshot,
  IBusinessModuleRepository,
  ListByKindAcrossProjectsOptions,
} from "@backend/domain/business-module/business-module.repository.ts";
import type {
  BusinessModuleItemSnapshot,
} from "@backend/domain/business-module/business-module-item.ts";
import type { BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import { DashboardUseCase } from "@backend/application/dashboard/dashboard.usecase.ts";
import {
  domainOk,
  type DomainResult,
} from "@backend/domain/shared/result.ts";

// ---------- Fake Project Repo ----------

class FakeProjectRepo implements IProjectRepository {
  /** 已存项目快照（按 save 顺序） */
  private readonly snapshots: ProjectSnapshot[] = [];

  async save(project: Project): Promise<DomainResult<void>> {
    this.snapshots.push(project.snapshot());
    return domainOk(undefined);
  }
  async findById(): Promise<DomainResult<Project>> {
    throw new Error("not used");
  }
  async findSnapshotById(): Promise<ProjectSnapshot | null> {
    return null;
  }
  async list(): Promise<ProjectListResult> {
    return { items: [], total: 0, limit: 0, offset: 0 };
  }
  async delete(): Promise<DomainResult<void>> {
    return domainOk(undefined);
  }
  async nextProjectCode(): Promise<string> {
    return "2026-00001";
  }
  async findByMentionToken(): Promise<ProjectSnapshot | null> {
    return null;
  }

  // 7.4g 用的 4 个聚合方法
  async countAll(): Promise<number> {
    return this.snapshots.length;
  }
  async countCreatedBetween(from: Date, to: Date): Promise<number> {
    return this.snapshots.filter((s) => s.createdAt >= from && s.createdAt < to).length;
  }
  async countByStatusInRange(
    status: "新建" | "提案中" | "暂停" | "中标" | "未中标",
    from: Date,
    to: Date,
  ): Promise<number> {
    // 模拟 sqlite 行为：对 中标/未中标 检查 date 字段；null 时 fallback 到 updated_at
    return this.snapshots.filter((s) => {
      if (s.status !== status) return false;
      const bucketDate = status === "中标"
        ? (s.wonDate ?? s.updatedAt)
        : status === "未中标"
        ? (s.lostDate ?? s.updatedAt)
        : s.updatedAt;
      return bucketDate >= from && bucketDate < to;
    }).length;
  }
  async monthlyStats(year: number): Promise<MonthlyStatRow[]> {
    // 12 行桶对齐
    const out: MonthlyStatRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const created = this.snapshots.filter((s) => {
        const d = s.createdAt;
        return d.getFullYear() === year && d.getMonth() + 1 === m;
      }).length;
      const won = this.snapshots.filter((s) => {
        if (s.status !== "中标") return false;
        const d = s.wonDate ?? s.updatedAt;
        return d.getFullYear() === year && d.getMonth() + 1 === m;
      }).length;
      const lost = this.snapshots.filter((s) => {
        if (s.status !== "未中标") return false;
        const d = s.lostDate ?? s.updatedAt;
        return d.getFullYear() === year && d.getMonth() + 1 === m;
      }).length;
      out.push({ month: m, created, won, lost });
    }
    return out;
  }

  // 助手：构造 + 落库（直接 push snapshot，不走真实聚合根方法）
  seed(snap: ProjectSnapshot): void {
    this.snapshots.push(snap);
  }
}

// ---------- Fake BusinessModule Repo ----------

interface AcrossRowInternal extends BusinessModuleItemSnapshot {
  projectName: string;
  clientName: string;
  planDate: string | null;
  clientContactName: string | null;
}

class FakeBusinessModuleRepo implements IBusinessModuleRepository {
  private readonly rows: AcrossRowInternal[] = [];

  async save(item: BusinessModuleItemSnapshot) {
    const idx = this.rows.findIndex((r) => r.id === item.id);
    if (idx >= 0) this.rows[idx] = { ...this.rows[idx], ...item };
    else this.rows.push({ ...item, projectName: "", clientName: "", planDate: null, clientContactName: null });
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByProjectAndKind(projectId: ProjectId, kind: BusinessModuleKind) {
    return this.rows.filter((r) => r.projectId === projectId && r.kind === kind);
  }
  async delete(id: string) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx >= 0) this.rows.splice(idx, 1);
  }
  async countAdoptedByProjectAndKind() {
    return 0;
  }
  async listByKindAcrossProjects(
    kind: BusinessModuleKind,
    opts: ListByKindAcrossProjectsOptions,
  ): Promise<BusinessModuleItemAcrossProjectsSnapshot[]> {
    let rows = this.rows.filter((r) => r.kind === kind);
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts.fromDate) rows = rows.filter((r) => (r.planDate ?? "") >= opts.fromDate!);
    if (opts.toDate) rows = rows.filter((r) => (r.planDate ?? "") <= opts.toDate!);
    if (opts.sortByPlanDate) {
      rows = [...rows].sort((a, b) => {
        const cmp = (a.planDate ?? "").localeCompare(b.planDate ?? "");
        return opts.sortByPlanDate === "asc" ? cmp : -cmp;
      });
    }
    if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
    return rows;
  }

  // 助手
  seed(row: AcrossRowInternal): void {
    this.rows.push(row);
  }
}

// ---------- 工具：构造 ProjectSnapshot ----------

function makeSnap(args: {
  id?: string;
  name?: string;
  clientName?: string;
  status?: "新建" | "提案中" | "暂停" | "中标" | "未中标";
  createdAt?: Date;
  updatedAt?: Date;
  wonDate?: Date | null;
  lostDate?: Date | null;
}): ProjectSnapshot {
  const id = args.id ?? newId<"ProjectId">();
  return {
    id: toProjectId(id),
    code: "2026-00001",
    name: args.name ?? "P",
    clientName: args.clientName ?? "C",
    status: args.status ?? "新建",
    createdAt: args.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    updatedAt: args.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
    contacts: [],
    teamMembers: [],
    wonDate: args.wonDate ?? null,
    lostDate: args.lostDate ?? null,
    lostReason: null,
    bestPractice: null,
    improvementNote: null,
    pauseReason: null,
  };
}

function makeActivity(args: {
  id?: string;
  projectId: ProjectId;
  title: string;
  planDate: string;
  status?: "pending" | "adopted" | "unadopted";
  projectName?: string;
  clientName?: string;
  clientContactName?: string | null;
}): AcrossRowInternal {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: args.id ?? newId<"BusinessModuleItemId">(),
    projectId: args.projectId,
    kind: "activity",
    title: args.title,
    content: "",
    status: args.status ?? "pending",
    payloadJson: JSON.stringify({
      planDate: args.planDate,
      clientContactName: args.clientContactName ?? null,
    }),
    createdAt: now,
    updatedAt: now,
    projectName: args.projectName ?? "",
    clientName: args.clientName ?? "",
    planDate: args.planDate,
    clientContactName: args.clientContactName ?? null,
  };
}

// ---------- 测试 ----------

const fixedClock = () => new FixedClock(new Date("2026-09-15T00:00:00Z"));

Deno.test("DashboardUseCase.getSummary —— 空库 → 全 0", async () => {
  const projectRepo = new FakeProjectRepo();
  const businessModuleRepo = new FakeBusinessModuleRepo();
  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo,
    clock: fixedClock(),
    yearProvider: () => 2026,
  });

  const r = await useCase.getSummary();
  assertEquals(r.monthNew, 0);
  assertEquals(r.yearWon, 0);
  assertEquals(r.yearLost, 0);
  assertEquals(r.total, 0);
  assertEquals(r.asOf, "2026-09-15T00:00:00.000Z");
});

Deno.test("DashboardUseCase.getSummary —— 本月 5 上月 3 → monthNew=5", async () => {
  const projectRepo = new FakeProjectRepo();
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-09-01T00:00:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-09-15T00:00:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-09-30T23:59:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-09-05T00:00:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-09-10T00:00:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-08-31T23:59:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-08-15T00:00:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-08-01T00:00:00Z") }));
  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo: new FakeBusinessModuleRepo(),
    clock: fixedClock(),
    yearProvider: () => 2026,
  });

  const r = await useCase.getSummary();
  assertEquals(r.monthNew, 5);
  assertEquals(r.total, 8);
});

Deno.test("DashboardUseCase.getSummary —— 中标 3 / 未中标 2 → yearWon=3, yearLost=2", async () => {
  const projectRepo = new FakeProjectRepo();
  projectRepo.seed(makeSnap({
    status: "中标",
    wonDate: new Date("2026-03-10T00:00:00Z"),
    updatedAt: new Date("2026-03-10T00:00:00Z"),
  }));
  projectRepo.seed(makeSnap({
    status: "中标",
    wonDate: new Date("2026-07-20T00:00:00Z"),
    updatedAt: new Date("2026-07-20T00:00:00Z"),
  }));
  projectRepo.seed(makeSnap({
    status: "中标",
    // 旧数据：wonDate 为 null，按 updated_at 年 fallback
    wonDate: null,
    updatedAt: new Date("2026-05-01T00:00:00Z"),
  }));
  projectRepo.seed(makeSnap({
    status: "未中标",
    lostDate: new Date("2026-04-05T00:00:00Z"),
    updatedAt: new Date("2026-04-05T00:00:00Z"),
  }));
  projectRepo.seed(makeSnap({
    status: "未中标",
    lostDate: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  }));
  projectRepo.seed(makeSnap({
    status: "未中标",
    // 跨年 —— 不应计入
    lostDate: new Date("2025-12-30T00:00:00Z"),
    updatedAt: new Date("2025-12-30T00:00:00Z"),
  }));

  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo: new FakeBusinessModuleRepo(),
    clock: fixedClock(),
    yearProvider: () => 2026,
  });

  const r = await useCase.getSummary();
  assertEquals(r.yearWon, 3);
  assertEquals(r.yearLost, 2);
  assertEquals(r.total, 6);
});

Deno.test("DashboardUseCase.getMonthlyStats —— 空年 → 12 行全 0", async () => {
  const projectRepo = new FakeProjectRepo();
  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo: new FakeBusinessModuleRepo(),
    clock: fixedClock(),
    yearProvider: () => 2026,
  });

  const r = await useCase.getMonthlyStats(2026);
  assertEquals(r.length, 12);
  assert(r.every((row) => row.created === 0 && row.won === 0 && row.lost === 0));
});

Deno.test("DashboardUseCase.getMonthlyStats —— 桶对齐（Mar/Jul/Nov 非零，其余 0）", async () => {
  const projectRepo = new FakeProjectRepo();
  // 3 月新增 2
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-03-05T00:00:00Z") }));
  projectRepo.seed(makeSnap({ createdAt: new Date("2026-03-28T00:00:00Z") }));
  // 7 月中标 1（wonDate=7 月；createdAt 设到 2025 以免影响 2026 任一月桶）
  projectRepo.seed(makeSnap({
    status: "中标",
    createdAt: new Date("2025-12-15T00:00:00Z"),
    wonDate: new Date("2026-07-15T00:00:00Z"),
    updatedAt: new Date("2026-07-15T00:00:00Z"),
  }));
  // 11 月未中标 2（一个 lostDate 11 月，一个 lostDate=null → updatedAt=11 月）
  projectRepo.seed(makeSnap({
    status: "未中标",
    createdAt: new Date("2025-12-15T00:00:00Z"),
    lostDate: new Date("2026-11-10T00:00:00Z"),
    updatedAt: new Date("2026-11-10T00:00:00Z"),
  }));
  projectRepo.seed(makeSnap({
    status: "未中标",
    createdAt: new Date("2025-12-15T00:00:00Z"),
    lostDate: null,
    updatedAt: new Date("2026-11-25T00:00:00Z"),
  }));

  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo: new FakeBusinessModuleRepo(),
    clock: fixedClock(),
    yearProvider: () => 2026,
  });

  const r = await useCase.getMonthlyStats(2026);
  const byMonth = new Map(r.map((x) => [x.month, x]));
  assertEquals(byMonth.get(3)?.created, 2);
  assertEquals(byMonth.get(7)?.won, 1);
  assertEquals(byMonth.get(11)?.lost, 2);
  // 其他月份都是 0
  for (let m = 1; m <= 12; m++) {
    if (m === 3 || m === 7 || m === 11) continue;
    const row = byMonth.get(m);
    assert(row);
    assertEquals(row.created, 0);
    assertEquals(row.won, 0);
    assertEquals(row.lost, 0);
  }
});

Deno.test("DashboardUseCase.getUpcomingActivities —— today 过滤 + limit + ASC 排序", async () => {
  const projectRepo = new FakeProjectRepo();
  const businessModuleRepo = new FakeBusinessModuleRepo();
  const pidA = toProjectId(newId<"ProjectId">());
  const pidB = toProjectId(newId<"ProjectId">());
  businessModuleRepo.seed(makeActivity({
    projectId: pidA,
    title: "A1 - 昨天 pending",
    planDate: "2026-09-14",
    status: "pending",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pidA,
    title: "A2 - 今天 pending",
    planDate: "2026-09-15",
    status: "pending",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pidA,
    title: "A3 - 已采纳",
    planDate: "2026-09-20",
    status: "adopted",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pidB,
    title: "B1 - 下周 pending",
    planDate: "2026-09-22",
    status: "pending",
    projectName: "Project B",
    clientName: "Client B",
    clientContactName: "Bob",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pidB,
    title: "B2 - 下月 pending",
    planDate: "2026-10-05",
    status: "pending",
    projectName: "Project B",
    clientName: "Client B",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pidB,
    title: "B3 - 三个月后 pending",
    planDate: "2026-11-30",
    status: "pending",
  }));

  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo,
    clock: fixedClock(),
    yearProvider: () => 2026,
    todayProvider: () => "2026-09-15",
  });

  const r = await useCase.getUpcomingActivities(5);
  // 排除：昨天（A1）、已采纳（A3）—— 入选 4 条（A2、B1、B2、B3），但 limit=5 全收
  assertEquals(r.length, 4);
  assertEquals(r[0].title, "A2 - 今天 pending");
  assertEquals(r[1].title, "B1 - 下周 pending");
  assertEquals(r[2].title, "B2 - 下月 pending");
  assertEquals(r[3].title, "B3 - 三个月后 pending");
  // 跨项目 join 字段
  assertEquals(r[1].projectName, "Project B");
  assertEquals(r[1].clientName, "Client B");
  assertEquals(r[1].clientContactName, "Bob");
});

Deno.test("DashboardUseCase.getUpcomingActivities —— limit=3 截断 + ASC", async () => {
  const projectRepo = new FakeProjectRepo();
  const businessModuleRepo = new FakeBusinessModuleRepo();
  const pid = toProjectId(newId<"ProjectId">());
  businessModuleRepo.seed(makeActivity({
    projectId: pid,
    title: "D-远",
    planDate: "2026-12-31",
    status: "pending",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pid,
    title: "B-中",
    planDate: "2026-10-15",
    status: "pending",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pid,
    title: "A-近",
    planDate: "2026-09-16",
    status: "pending",
  }));
  businessModuleRepo.seed(makeActivity({
    projectId: pid,
    title: "C-远中",
    planDate: "2026-11-20",
    status: "pending",
  }));

  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo,
    clock: fixedClock(),
    yearProvider: () => 2026,
    todayProvider: () => "2026-09-15",
  });

  const r = await useCase.getUpcomingActivities(3);
  assertEquals(r.length, 3);
  assertEquals(r.map((x) => x.title), ["A-近", "B-中", "C-远中"]);
});

Deno.test("DashboardUseCase.getUpcomingActivities —— planDate 为空 → 过滤", async () => {
  const projectRepo = new FakeProjectRepo();
  const businessModuleRepo = new FakeBusinessModuleRepo();
  const pid = toProjectId(newId<"ProjectId">());
  // 直接 push 一条没 planDate 的（绕过 useCase 之前的过滤）
  businessModuleRepo.seed({
    id: newId<"BusinessModuleItemId">(),
    projectId: pid,
    kind: "activity",
    title: "No planDate",
    content: "",
    status: "pending",
    payloadJson: "{}",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    projectName: "X",
    clientName: "Y",
    planDate: null,
    clientContactName: null,
  });
  businessModuleRepo.seed(makeActivity({
    projectId: pid,
    title: "With planDate",
    planDate: "2026-09-20",
    status: "pending",
  }));

  const useCase = new DashboardUseCase({
    projectRepo,
    businessModuleRepo,
    clock: fixedClock(),
    yearProvider: () => 2026,
    todayProvider: () => "2026-09-15",
  });

  const r = await useCase.getUpcomingActivities(5);
  assertEquals(r.length, 1);
  assertEquals(r[0].title, "With planDate");
});
