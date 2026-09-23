/**
 * QuoteUseCase —— 报价单用例编排
 *
 * 阶段 7.4f。
 *
 * 职责：
 *   - 拉取 function_list / budget_settings / hardware_items → 派生 QuoteSnapshot
 *   - AI 起草 markdown 说明（非流式；调用 sub-agent 单次完成）
 *   - 用模板 + 数据生成 .xlsx，写盘 + 入 quote_runs
 *   - 列表 / 查询 / 下载 run
 *
 * 不接真实 SMTP；邮件附件复用 MailUseCase.addAttachment（阶段 7.4e）。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";
import { SystemClock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { HardwareItemsUseCase } from "../business-module/hardware-items.usecase.ts";
import type { StructuredModulesUseCase } from "../business-module/structured-modules.usecase.ts";
import type { IProjectRepository } from "@backend/domain/project/project.repository.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";
import type { ProjectSnapshot } from "@backend/domain/project/project.ts";
import {
  computeQuoteSnapshot,
  type QuoteSnapshot,
} from "@backend/domain/quote/quote-snapshot.ts";
import type { ExcelFiller } from "./excel-filler.ts";
import type { FilesystemQuoteStorage } from "./quote.storage.ts";
import type {
  IQuoteRunsRepository,
  QuoteRunSnapshot,
} from "@backend/persistence/sqlite/sqlite-quote-runs.repository.ts";
import type {
  IQuoteTemplatesRepository,
  QuoteTemplateSnapshot,
} from "@backend/persistence/sqlite/sqlite-quote-templates.repository.ts";

const uuidGenerate = (): string => crypto.randomUUID();

export interface QuoteRunResult {
  id: string;
  projectId: ProjectId;
  templateId: string | null;
  templateFilename: string | null;
  userInput: string;
  aiMarkdown: string;
  summary: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  outputPath: string;
  mimeType: string;
  createdAt: string;
  downloadUrl: string;
}

function toRunResult(snap: QuoteRunSnapshot, templateFilename: string | null): QuoteRunResult {
  return {
    id: snap.id,
    projectId: snap.projectId,
    templateId: snap.templateId,
    templateFilename,
    userInput: snap.userInput,
    aiMarkdown: snap.aiMarkdown,
    summary: safeParse(snap.summaryJson),
    sourceSnapshot: safeParse(snap.sourceSnapshotJson),
    outputPath: snap.outputPath,
    mimeType: snap.mimeType,
    createdAt: snap.createdAt,
    downloadUrl: `/api/projects/${snap.projectId}/quote/runs/${snap.id}/download`,
  };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface GenerateXlsxArgs {
  templateId?: string;
  userInput: string;
  aiMarkdown?: string;
}

export interface QuoteUseCaseDeps {
  hardwareUseCase: HardwareItemsUseCase;
  structuredModules: StructuredModulesUseCase;
  projectRepo: IProjectRepository;
  runsRepo: IQuoteRunsRepository;
  templatesRepo: IQuoteTemplatesRepository;
  storage: FilesystemQuoteStorage;
  filler: ExcelFiller;
  clock?: Clock;
  logger?: Logger;
  /** 用于 AI 起草（注入则启用；未注入则走 fallback） */
  aiGenerateMarkdown?: (args: { snapshot: QuoteSnapshot; userInput: string; projectCode: string; projectName: string; clientName: string }) => Promise<string>;
}

export class QuoteUseCase {
  private readonly clock: Clock;
  private readonly logger: Logger | undefined;

  constructor(private readonly deps: QuoteUseCaseDeps) {
    this.clock = deps.clock ?? new SystemClock();
    this.logger = deps.logger;
  }

  /** 实时派生 */
  async computeQuote(projectId: ProjectId): Promise<DomainResult<QuoteSnapshot>> {
    try {
      const snap = await this.buildSnapshot(projectId);
      return domainOk(snap);
    } catch (e) {
      return domainErr("INTERNAL", e instanceof Error ? e.message : String(e));
    }
  }

  /** 列出所有可用模板（内置默认 + 项目上传） */
  async listTemplates(projectId: ProjectId): Promise<QuoteTemplateSnapshot[]> {
    return await this.deps.templatesRepo.listForProject(projectId);
  }

  /** 上传项目模板 */
  async uploadTemplate(
    projectId: ProjectId,
    args: { filename: string; mime: string; bytes: Uint8Array },
  ): Promise<DomainResult<QuoteTemplateSnapshot>> {
    // mime 容错：仅当用户明确给了非 xlsx 的 mime 才拒绝；
    // octet-stream / 空 mime 走 magic bytes 校验。
    if (
      args.mime && args.mime !== "" && args.mime !== "application/octet-stream" &&
      args.mime !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
      args.mime !== "application/zip"
    ) {
      return domainErr("INVALID_INPUT", `unsupported mime: ${args.mime}`);
    }
    if (args.bytes.byteLength < 4) {
      return domainErr("INVALID_INPUT", "file too small to be a valid xlsx");
    }
    // ZIP magic bytes
    if (args.bytes[0] !== 0x50 || args.bytes[1] !== 0x4b || args.bytes[2] !== 0x03 || args.bytes[3] !== 0x04) {
      return domainErr("INVALID_INPUT", "file magic bytes do not match xlsx");
    }
    // filename 消毒
    const safe = args.filename
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/^\.+/, "")
      .replace(/\s+/g, "_");
    if (safe.length === 0 || /^_+$/.test(safe)) {
      return domainErr("INVALID_INPUT", "filename invalid after sanitization");
    }
    const dir = await this.deps.storage.projectTemplateDir(projectId);
    const path = this.deps.storage.projectTemplatePath(projectId, safe);
    await this.deps.storage.writeTemplate(path, args.bytes);
    const snap: QuoteTemplateSnapshot = {
      id: uuidGenerate(),
      filename: safe,
      originalFilename: args.filename,
      mime: args.mime,
      size: args.bytes.byteLength,
      projectId,
      pathOnDisk: path,
      uploadedAt: this.clock.now().toISOString(),
    };
    await this.deps.templatesRepo.insert(snap);
    return domainOk(snap);
  }

  /** 删除模板（不允许删内置默认） */
  async deleteTemplate(id: string): Promise<DomainResult<void>> {
    const t = await this.deps.templatesRepo.findById(id);
    if (!t) return domainErr("NOT_FOUND", `template ${id} not found`);
    if (t.projectId === null) {
      return domainErr("INVALID_INPUT", "cannot delete built-in default template");
    }
    await this.deps.templatesRepo.delete(id);
    try {
      await Deno.remove(t.pathOnDisk);
    } catch {
      // 文件可能已不在；忽略
    }
    return domainOk(undefined);
  }

  /** 查单个模板（用于下载端点） */
  async findTemplateById(id: string): Promise<DomainResult<QuoteTemplateSnapshot>> {
    const t = await this.deps.templatesRepo.findById(id);
    if (!t) return domainErr("NOT_FOUND", `template ${id} not found`);
    return domainOk(t);
  }

  /** AI 起草 markdown 说明（占位：若 deps.aiGenerateMarkdown 未注入，返回 INTERNAL） */
  async aiGenerateDraft(
    projectId: ProjectId,
    userInput: string,
  ): Promise<DomainResult<{ markdown: string }>> {
    if (!this.deps.aiGenerateMarkdown) {
      return domainErr(
        "INTERNAL",
        "AI sub-agent not wired; aiGenerateMarkdown callback is missing",
      );
    }
    const snap = await this.buildSnapshot(projectId);
    const proj = await this.fetchProjectSnapshot(projectId);
    const md = await this.deps.aiGenerateMarkdown({
      snapshot: snap,
      userInput,
      projectCode: proj.code,
      projectName: proj.name,
      clientName: proj.clientName,
    });
    return domainOk({ markdown: md });
  }

  /** 用模板 + 数据生成 .xlsx，写盘 + 入库；返回 run id + bytes */
  async generateXlsx(
    projectId: ProjectId,
    args: GenerateXlsxArgs,
  ): Promise<DomainResult<{ runId: string; bytes: Uint8Array; filename: string; mimeType: string }>> {
    const snap = await this.buildSnapshot(projectId);
    const proj = await this.fetchProjectSnapshot(projectId);
    const template = await this.resolveTemplate(args.templateId, projectId);
    const templateBytes = template ? await this.deps.storage.readTemplate(template.pathOnDisk) : null;

    const fillResult = await this.deps.filler.fill({
      templateBytes,
      snapshot: snap,
      aiMarkdown: args.aiMarkdown ?? "",
      meta: {
        projectCode: proj.code,
        projectName: proj.name,
        clientName: proj.clientName,
        createdAt: this.clock.now(),
      },
    });

    const runId = uuidGenerate();
    const outputPath = this.deps.storage.outputPath(projectId, runId);
    await this.deps.storage.writeOutput(outputPath, fillResult.bytes);

    const sourceSnapshot = {
      functions: [], // 不重放全量；此处只用 budget_summary.top + hardware
      budgetTop: snap.top,
      hardwareItems: snap.hardware.items,
      grandTotalExclTax: snap.grandTotalExclTax,
    };

    const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const now = this.clock.now().toISOString();
    const runSnap: QuoteRunSnapshot = {
      id: runId,
      projectId,
      templateId: template?.id ?? null,
      userInput: args.userInput ?? "",
      aiMarkdown: args.aiMarkdown ?? "",
      summaryJson: JSON.stringify({
        top: snap.top,
        software: snap.software,
        hardware: snap.hardware.subtotal,
        deployTraining: snap.deployTraining,
        grandTotalExclTax: snap.grandTotalExclTax,
      }),
      sourceSnapshotJson: JSON.stringify(sourceSnapshot),
      outputPath,
      mimeType,
      createdAt: now,
    };
    await this.deps.runsRepo.insert(runSnap);

    this.logger?.info("quote generated", {
      projectId,
      runId,
      templateId: template?.id ?? null,
      bytes: fillResult.bytes.byteLength,
    });

    return domainOk({
      runId,
      bytes: fillResult.bytes,
      filename: fillResult.filename,
      mimeType,
    });
  }

  async listRuns(projectId: ProjectId): Promise<QuoteRunResult[]> {
    const runs = await this.deps.runsRepo.listByProject(projectId);
    const result: QuoteRunResult[] = [];
    for (const r of runs) {
      let templateFilename: string | null = null;
      if (r.templateId) {
        const t = await this.deps.templatesRepo.findById(r.templateId);
        templateFilename = t?.originalFilename ?? null;
      }
      result.push(toRunResult(r, templateFilename));
    }
    return result;
  }

  async getRun(runId: string): Promise<DomainResult<QuoteRunResult>> {
    const r = await this.deps.runsRepo.findById(runId);
    if (!r) return domainErr("NOT_FOUND", `quote run ${runId} not found`);
    let templateFilename: string | null = null;
    if (r.templateId) {
      const t = await this.deps.templatesRepo.findById(r.templateId);
      templateFilename = t?.originalFilename ?? null;
    }
    return domainOk(toRunResult(r, templateFilename));
  }

  async downloadRun(runId: string): Promise<DomainResult<{ bytes: Uint8Array; filename: string; mimeType: string }>> {
    const r = await this.deps.runsRepo.findById(runId);
    if (!r) return domainErr("NOT_FOUND", `quote run ${runId} not found`);
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.storage.readOutput(r.outputPath);
    } catch (e) {
      return domainErr("INTERNAL", `read output failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return domainOk({
      bytes,
      filename: `quote-${r.id}.xlsx`,
      mimeType: r.mimeType,
    });
  }

  async deleteRun(runId: string): Promise<DomainResult<void>> {
    const r = await this.deps.runsRepo.findById(runId);
    if (!r) return domainErr("NOT_FOUND", `quote run ${runId} not found`);
    await this.deps.runsRepo.delete(runId);
    try {
      await Deno.remove(r.outputPath);
    } catch {
      // 文件可能已不在；忽略
    }
    return domainOk(undefined);
  }

  // ---------- internal helpers ----------

  private async buildSnapshot(projectId: ProjectId): Promise<QuoteSnapshot> {
    const [functions, settings, hardware] = await Promise.all([
      this.deps.structuredModules.listFunctions(projectId),
      this.deps.structuredModules.getBudgetSettings(projectId),
      this.deps.hardwareUseCase.getPayload(projectId),
    ]);
    const fnPayloads = functions.map((f) => ({
      category: f.category,
      module: f.module,
      name: f.name,
      detail: f.detail,
      remarks: f.remarks,
      cp: f.cp,
      inScope: f.inScope,
    }));
    return computeQuoteSnapshot({
      functions: fnPayloads,
      settings,
      hardware,
    });
  }

  private async fetchProjectSnapshot(projectId: ProjectId): Promise<{
    code: string;
    name: string;
    clientName: string;
  }> {
    const snap = await this.deps.projectRepo.findSnapshotById(projectId);
    if (!snap) {
      return { code: "", name: "", clientName: "" };
    }
    return {
      code: snap.code ?? "",
      name: snap.name ?? "",
      clientName: snap.clientName ?? "",
    };
  }

  private async resolveTemplate(
    templateId: string | undefined,
    projectId: ProjectId,
  ): Promise<QuoteTemplateSnapshot | null> {
    if (templateId) {
      const t = await this.deps.templatesRepo.findById(templateId);
      if (!t) return null;
      // 校验：项目模板必须属于该项目；或内置默认（projectId IS NULL）
      if (t.projectId !== null && t.projectId !== projectId) {
        return null;
      }
      return t;
    }
    return await this.deps.templatesRepo.findDefault();
  }
}