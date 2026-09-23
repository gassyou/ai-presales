/**
 * PptUseCase —— 提案 PPT 设计用例
 *
 * 阶段 7.4c。
 *
 *   list / create / update / delete / reorder / exportMarkdown：同步 CRUD
 *   generatePages：流式 AI 生成（yield ppt_page 事件）
 *
 * AI 流式要点：
 *   - 直接调 ILLMClient.chat（单轮，避免 sub-agent tool-use 的额外开销）
 *   - systemPrompt 用 ppt-designer 的硬编码（避免依赖 sub-agent 注册表）
 *   - 解析响应为 JSON { pages: [...] }；每解析出一页 yield 一条 ppt_page 事件并落库
 *   - 解析失败：yield 一张错误页（"解析失败"），event 流不阻塞
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import { SystemClock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import { newId, type ProjectId } from "@shared/types/ids.ts";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  defaultPosition,
  pptPageToSnap,
  snapToPptPage,
  validatePptPagePatch,
  type PptPage,
  type PptPagePatch,
  type PptPageSnapshot,
} from "@backend/domain/business-module/ppt-page.ts";
import type { IPptPagesRepository } from "@backend/persistence/sqlite/sqlite-ppt-pages.repository.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ChatRequest, StreamEvent } from "@backend/ai/message/canonical-message.ts";

export interface PptPageResult {
  id: string;
  projectId: string;
  ordinal: number;
  title: string;
  prompt: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export interface PptPageInput {
  title: string;
  prompt?: string;
  ordinal?: number;
  positionX?: number;
  positionY?: number;
}

export interface GeneratePagesDeps {
  client: ILLMClient;
  /** profile 名（如 fast / deep）—— 决定模型与温度 */
  profile: { name: string; model: string; temperature: number; maxOutputTokens: number };
}

const PPT_DESIGNER_SYSTEM = `你是"提案 PPT 设计"助手。
用户会告诉你一个提案主题 / 客户 / 受众，请根据该输入设计一份完整的 PPT 页面清单。

严格要求：
- 仅输出一段 **严格合法的 JSON** 字符串，不要任何其它文字、注释、Markdown 围栏
- 顶层 JSON 形状：{"pages":[{"ordinal":<1-based int>,"title":"<PPT 页标题>","prompt":"<该页 AI 提示词>"}]}
- 总页数 8~15 页
- ordinal 严格从 1 开始递增
- title 简洁，不超过 20 字；不要出现句号 / 换行
- prompt 完整独立（即使脱离上下文也能用），需包含：
  · 目标受众与场景（谁看 / 何时看）
  · 视觉风格建议（颜色 / 排版 / 图表类型）
  · 3~5 条关键要点（每条独立一行）
  · 建议配图或数据图（图表类型 + 内容提示）
- 内容需与输入主题一致，不要凭空捏造客户名 / 数据；若信息不足，标注 TBD`;

export class PptUseCase {
  private readonly clock: Clock;
  constructor(
    private readonly repo: IPptPagesRepository,
    private readonly logger: Logger,
    clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  // ---------- 列表 ----------

  async list(projectId: ProjectId): Promise<PptPageResult[]> {
    const snaps = await this.repo.listByProject(projectId);
    return snaps.map(toResult);
  }

  // ---------- 新建 ----------

  async create(
    projectId: ProjectId,
    input: PptPageInput,
  ): Promise<DomainResult<PptPageResult>> {
    // 复用 patch 校验（bounds + 非空）；不传字段不参与
    const candidate: PptPagePatch = {
      title: input.title ?? "",
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}),
      ...(input.positionX !== undefined ? { positionX: input.positionX } : {}),
      ...(input.positionY !== undefined ? { positionY: input.positionY } : {}),
    };
    const err = validatePptPagePatch(candidate);
    if (err !== null) return domainErr("INVALID_INPUT", err);
    // ordinal 默认取「当前最大 + 1」（删除后不会出现序号冲突）
    const existing = await this.repo.listByProject(projectId);
    const nextOrdinal = existing.reduce(
      (m, p) => Math.max(m, p.ordinal),
      -1,
    ) + 1;
    const ordinal = input.ordinal ?? nextOrdinal;
    const pos = input.positionX !== undefined && input.positionY !== undefined
      ? { x: input.positionX, y: input.positionY }
      : defaultPosition(ordinal);
    const now = this.clock.now();
    const page: PptPage = {
      id: newId<"PptPageId">(),
      projectId,
      ordinal,
      title: input.title.trim(),
      prompt: input.prompt ?? "",
      positionX: pos.x,
      positionY: pos.y,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      createdAt: now,
      updatedAt: now,
    };
    const snap = pptPageToSnap(page);
    await this.repo.insert(snap);
    return domainOk(toResult(snap));
  }

  // ---------- 更新 ----------

  async update(id: string, patch: PptPagePatch): Promise<DomainResult<PptPageResult>> {
    const err = validatePptPagePatch(patch);
    if (err !== null) return domainErr("INVALID_INPUT", err);
    const existing = await this.repo.findById(id);
    if (!existing) return domainErr("NOT_FOUND", `ppt page ${id} not found`);
    const now = this.clock.now();
    await this.repo.update(id, patch, now);
    const updated = await this.repo.findById(id);
    if (!updated) return domainErr("NOT_FOUND", `ppt page ${id} not found`);
    return domainOk(toResult(updated));
  }

  // ---------- 删除 ----------

  async delete(id: string): Promise<DomainResult<void>> {
    await this.repo.delete(id);
    return domainOk(undefined);
  }

  // ---------- 拖拽排序（批量刷 ordinal） ----------

  async reorder(
    projectId: ProjectId,
    orderedIds: readonly string[],
  ): Promise<DomainResult<void>> {
    // 校验：所有 id 必须属于该项目
    const existing = await this.repo.listByProject(projectId);
    const existingIds = new Set(existing.map((p) => p.id));
    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        return domainErr("INVALID_INPUT", `ppt page ${id} not in project`);
      }
    }
    await this.repo.reorderBulk(orderedIds, projectId, this.clock.now());
    return domainOk(undefined);
  }

  // ---------- Markdown 导出 ----------

  async exportMarkdown(projectId: ProjectId): Promise<DomainResult<{ markdown: string }>> {
    const snaps = await this.repo.listByProject(projectId);
    const sorted = [...snaps].sort((a, b) => a.ordinal - b.ordinal);
    const lines: string[] = ["# 提案 PPT 设计", ""];
    for (const p of sorted) {
      lines.push(`## ${p.ordinal + 1}. ${p.title}`);
      lines.push("");
      // prompt 多行保留为段
      lines.push(p.prompt.trim());
      lines.push("");
    }
    return domainOk({ markdown: lines.join("\n") });
  }

  // ---------- AI 流式生成 ----------

  async *generatePages(
    projectId: ProjectId,
    userInput: string,
    deps: GeneratePagesDeps,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    if (!userInput || userInput.trim().length === 0) {
      yield { type: "error", code: "INVALID_INPUT", message: "userInput 不能为空", retryable: false };
      return;
    }

    const req: ChatRequest = {
      systemPrompt: PPT_DESIGNER_SYSTEM,
      messages: [
        { role: "user", content: [{ type: "text", text: userInput }] },
      ],
      model: deps.profile.model,
      temperature: deps.profile.temperature,
      maxOutputTokens: deps.profile.maxOutputTokens,
      ...(signal !== undefined ? { signal } : {}),
    };

    let result;
    try {
      result = await deps.client.chat(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn("ppt generate: LLM error", { message: msg });
      yield { type: "error", code: "LLM_INTERNAL", message: msg, retryable: true };
      return;
    }

    // 提取文本
    const fullText = result.message.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    if (fullText.trim().length === 0) {
      yield { type: "error", code: "LLM_EMPTY", message: "LLM 返回为空", retryable: true };
      return;
    }

    // 解析 JSON
    const pages = parsePagesJson(fullText, this.logger);
    if (pages.length === 0) {
      yield {
        type: "error",
        code: "PPT_PARSE_FAILED",
        message: "解析失败：未抽取到任何页面",
        retryable: false,
      };
      return;
    }

    // 流式落库 + yield
    // 起始位置取一次快照，之后每插入一张递增 1（避免每页都跑 listByProject）
    let baseCount = (await this.repo.listByProject(projectId)).length;
    for (const pg of pages) {
      if (signal?.aborted) {
        yield { type: "error", code: "ABORTED", message: "aborted by user", retryable: false };
        return;
      }
      const ordinal = pg.ordinal ?? baseCount;
      const pos = defaultPosition(baseCount);
      const now = this.clock.now();
      const page: PptPage = {
        id: newId<"PptPageId">(),
        projectId,
        ordinal,
        title: pg.title,
        prompt: pg.prompt,
        positionX: pos.x,
        positionY: pos.y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        createdAt: now,
        updatedAt: now,
      };
      await this.repo.insert(pptPageToSnap(page));

      yield {
        type: "ppt_page",
        pageId: page.id,
        ordinal: page.ordinal,
        title: page.title,
        prompt: page.prompt,
        model: result.message.model,
      };
      baseCount++;
    }

    yield {
      type: "done",
      messageId: result.message.model,
      usage: result.message.usage,
    };
  }
}

function toResult(snap: PptPageSnapshot): PptPageResult {
  const p = snapToPptPage(snap);
  return {
    id: p.id,
    projectId: String(p.projectId),
    ordinal: p.ordinal,
    title: p.title,
    prompt: p.prompt,
    positionX: p.positionX,
    positionY: p.positionY,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

interface ParsedPage {
  ordinal: number;
  title: string;
  prompt: string;
}

/** 从 LLM 输出文本中尽量宽松地抽取 JSON 数组 */
function parsePagesJson(text: string, logger: Logger): ParsedPage[] {
  const stripped = stripCodeFence(text).trim();
  // 优先尝试整段 JSON.parse
  try {
    const obj = JSON.parse(stripped) as { pages?: unknown };
    if (obj && Array.isArray(obj.pages)) return normalize(obj.pages);
  } catch {/* fallback */}
  // 退化：找第一个 { 到最后一个 } 的子串
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const obj = JSON.parse(stripped.slice(first, last + 1)) as { pages?: unknown };
      if (obj && Array.isArray(obj.pages)) return normalize(obj.pages);
    } catch (e) {
      logger.warn("ppt JSON parse failed", { message: e instanceof Error ? e.message : String(e) });
    }
  }
  return [];
}

/** 去掉 ```json ... ``` 或 ``` ... ``` 围栏 */
function stripCodeFence(text: string): string {
  // 匹配 ``` 可选语言标签，到下一个 ``` 的内容（非贪婪）
  const m = /```(?:[a-zA-Z][\w-]*)?\s*([\s\S]*?)\s*```/m.exec(text);
  if (m && m[1]) return m[1];
  return text;
}

function normalize(raw: unknown): ParsedPage[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedPage[] = [];
  let i = 0;
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const obj = it as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
    if (!title || !prompt) continue;
    const ordRaw = obj.ordinal;
    const ordinal = typeof ordRaw === "number" && Number.isFinite(ordRaw)
      ? Math.max(0, Math.floor(ordRaw) - 1) // 规整为 0-based
      : i;
    out.push({ ordinal, title, prompt });
    i++;
  }
  return out;
}