/**
 * BusinessModuleService —— 业务模块通用用例编排
 *
 * 阶段 7.0。20+ 业务模块共用一份用例骨架：
 *   - listItems(projectId, kind)
 *   - getItem(id)
 *   - createItem(projectId, kind, title, content?, payload?)
 *   - updateItem(id, { title?, content?, payload?, status? })
 *   - deleteItem(id)
 *   - setAdoption(id, "adopted" | "unadopted")
 *   - generatePlaceholder(id)：custom kind 真调 markdown-author；未注入时退化
 *
 * 不变量：
 *   - 跨 kind 走同一份仓储
 *   - markdown_* 类模块默认 status="adopted"（用户手写即采纳）
 *   - 结构化模块默认 status="pending"（待用户确认）
 *   - create / update 都返回最新 snapshot
 *
 * 后续阶段在此 service 之上挂 generateContent（AI 异步）/ previewMarkdown 等模块专用 usecase。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { SystemClock, type Clock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import {
  BusinessModuleItem,
  type BusinessModuleItemSnapshot,
} from "@backend/domain/business-module/business-module-item.ts";
import { isMarkdownKind, type BusinessModuleKind } from "@backend/domain/business-module/business-module.ts";
import type { IBusinessModuleRepository } from "@backend/domain/business-module/business-module.repository.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import { collectStreamToString } from "@backend/application/shared/stream-helpers.ts";

/** 阶段 7.5（H5）：可选注入 sub-agent 调用闭包；未注入时 generatePlaceholder 退化为原模板占位 */
export type InvokeSubAgentFn = (
  subAgentName: string,
  userInput: string,
  opts?: { signal?: AbortSignal },
) => AsyncIterable<StreamEvent>;

export interface BusinessModuleServiceDeps {
  repo: IBusinessModuleRepository;
  clock?: Clock;
  invokeSubAgent?: InvokeSubAgentFn;
  getProjectMeta?: (projectId: ProjectId) => Promise<{ name: string; clientName: string } | null>;
}

export interface CreateItemInput {
  title: string;
  content?: string;
  payloadJson?: string;
  /** 覆盖默认 status（默认 markdown=adopted / 结构化=pending） */
  initialStatus?: "pending" | "adopted" | "unadopted";
}

export interface UpdateItemInput {
  title?: string;
  content?: string;
  payloadJson?: string;
  status?: "pending" | "adopted" | "unadopted";
}

export class BusinessModuleService {
  private readonly repo: IBusinessModuleRepository;
  private readonly clock: Clock;
  /** 阶段 7.5（H5）：可选 sub-agent 调用闭包 */
  private readonly invokeSubAgent: InvokeSubAgentFn | undefined;
  /** 阶段 7.5（H5）：可选项目元信息拉取函数 */
  private readonly getProjectMeta: ((projectId: ProjectId) => Promise<{ name: string; clientName: string } | null>) | undefined;

  constructor(deps: BusinessModuleServiceDeps) {
    this.repo = deps.repo;
    this.clock = deps.clock ?? new SystemClock();
    this.invokeSubAgent = deps.invokeSubAgent;
    this.getProjectMeta = deps.getProjectMeta;
  }

  async listItems(
    projectId: ProjectId,
    kind: BusinessModuleKind,
    opts?: { status?: "pending" | "adopted" | "unadopted" },
  ): Promise<BusinessModuleItemSnapshot[]> {
    return await this.repo.listByProjectAndKind(projectId, kind, opts);
  }

  async getItem(id: string): Promise<DomainResult<BusinessModuleItemSnapshot>> {
    const snap = await this.repo.findById(id);
    if (!snap) return domainErr("NOT_FOUND", `business module item ${id} not found`);
    return domainOk(snap);
  }

  async createItem(
    projectId: ProjectId,
    kind: BusinessModuleKind,
    input: CreateItemInput,
  ): Promise<DomainResult<BusinessModuleItemSnapshot>> {
    const initialStatus = input.initialStatus ?? (isMarkdownKind(kind) ? "adopted" : "pending");
    const r = BusinessModuleItem.create({
      projectId,
      kind,
      title: input.title,
      content: input.content,
      status: initialStatus,
      payloadJson: input.payloadJson,
      clock: this.clock,
    });
    if (!r.ok) return r;
    await this.repo.save(r.value.snapshot());
    return domainOk(r.value.snapshot());
  }

  async updateItem(id: string, input: UpdateItemInput): Promise<DomainResult<BusinessModuleItemSnapshot>> {
    const existing = await this.repo.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `business module item ${id} not found`);
    const agg = BusinessModuleItem.rehydrate(existing);
    const r = agg.update(input, this.clock);
    if (!r.ok) return r;
    const snap = agg.snapshot();
    await this.repo.save(snap);
    return domainOk(snap);
  }

  async deleteItem(id: string): Promise<DomainResult<void>> {
    const existing = await this.repo.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `business module item ${id} not found`);
    await this.repo.delete(id);
    return domainOk(undefined);
  }

  async adopt(id: string): Promise<DomainResult<BusinessModuleItemSnapshot>> {
    return await this.updateItem(id, { status: "adopted" });
  }

  async unadopt(id: string): Promise<DomainResult<BusinessModuleItemSnapshot>> {
    return await this.updateItem(id, { status: "unadopted" });
  }

  async countAdopted(projectId: ProjectId, kind: BusinessModuleKind): Promise<number> {
    return await this.repo.countAdoptedByProjectAndKind(projectId, kind);
  }

  /**
   * AI 生成（仅 kind="custom"；markdown_* 走 markdown-module 专属端点）
   *
   * 阶段 7.5（H5）改造：
   *   - invokeSubAgent 已注入 → 调 markdown-author 真生成；失败降级
   *   - 未注入 → 沿用 7.4d 模板占位（dev/测试 fallback）
   */
  async generatePlaceholder(itemId: string): Promise<DomainResult<BusinessModuleItemSnapshot>> {
    const existing = await this.repo.findById(itemId);
    if (!existing) return domainErr("NOT_FOUND", `business module item ${itemId} not found`);
    if (existing.kind !== "custom") {
      return domainErr(
        "INVALID_INPUT",
        `generate not supported for kind=${existing.kind}; use kind-scoped endpoint`,
      );
    }

    const stamp = this.clock.now().toISOString();
    let body: string;
    if (this.invokeSubAgent) {
      const meta = await this.safeGetProjectMeta(existing.projectId);
      const ctx = meta ? `项目名：${meta.name}\n客户：${meta.clientName}\n` : "";
      const existingText = existing.content && existing.content.trim().length > 0
        ? `已有内容（请在此基础上扩展 / 改写）：\n${existing.content}\n`
        : "暂无已有内容。\n";
      const userInput = `请为业务模块「${existing.title}」撰写 markdown 正文（300~1500 字）。
${ctx}
${existingText}
要求：
- 仅输出 markdown 正文，不要 JSON / 元注释 / Markdown 围栏
- 结构清晰，能列点就列点
- 不要杜撰客户名 / 金额；信息不足时标 TBD`;
      try {
        body = await collectStreamToString(this.invokeSubAgent("markdown-author", userInput));
      } catch (e) {
        body = `（开始在此处编辑 ${existing.title} 的内容）\n\n> AI 生成失败：${e instanceof Error ? e.message : String(e)}\n`;
      }
      if (!body.trim()) {
        body = `（开始在此处编辑 ${existing.title} 的内容）\n`;
      }
    } else {
      // 旧模板占位（dev/测试 fallback）
      body = existing.content && existing.content.trim().length > 0
        ? existing.content
        : `（开始在此处编辑 ${existing.title} 的内容）\n`;
    }

    const stamped = `# ${existing.title}\n\n` +
      `> 生成时间：${stamp}\n\n` +
      body;
    return await this.updateItem(itemId, { content: stamped });
  }

  /** 阶段 7.5（H5）：内部辅助 — 拉项目元信息（拿不到不抛错） */
  private async safeGetProjectMeta(projectId: ProjectId): Promise<{ name: string; clientName: string } | null> {
    if (!this.getProjectMeta) return null;
    try {
      return await this.getProjectMeta(projectId);
    } catch {
      return null;
    }
  }
}
