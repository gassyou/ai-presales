/**
 * ToolExecutor —— 单次工具调用执行器
 *
 * 流程：
 *   1. 从 ToolRegistry 取 tool（缺 → 抛 TOOL_NOT_FOUND）
 *   2. requiresApproval → 本期 stub 直接通过（阶段 6+ 接审批流）
 *   3. allowedPaths 校验（仅 read/write 工具）
 *   4. 设超时 + AbortSignal
 *   5. tool.execute(args, ctx)
 *   6. 异常 → 包成 ToolOutcome.ok=false
 *
 * 输出 ToolOutcome，由调用方回灌给 LLM。
 */

import type { IToolRegistry } from "./tool-registry.ts";
import type { Tool, ToolContext, ToolInvocation, ToolOutcome } from "./tool.ts";
import { fail, ok } from "./tool.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export interface ToolExecutorOptions {
  readonly registry: IToolRegistry;
  readonly logger: Logger;
  readonly cwd: string;
  readonly allowedPaths: readonly string[];
  readonly defaultTimeoutMs?: number;
  /**
   * 阶段 H+2：force 决策（一次性，按 tool 名）。
   * - forceApproveNames 中的 tool 名 → 跳过 requiresApproval 检查
   * - forceRejectNames 中的 tool 名 → 返 USER_REJECTED
   */
  readonly forceApproveNames?: readonly string[];
  readonly forceRejectNames?: readonly string[];
  /**
   * 阶段 13（PR #8）：会话级"全部自动批准工具"开关。
   * true → 跳过 requiresApproval 检查（等价于把所有 tool 名都加进 forceApproveNames）。
   * 注：仍然尊重 forceRejectNames（用户显式拒绝的不执行）。
   */
  readonly forceApproveAll?: boolean;
}

export class ToolExecutor {
  private readonly opts: ToolExecutorOptions;

  constructor(opts: ToolExecutorOptions) {
    this.opts = opts;
  }

  async executeOne(invocation: ToolInvocation): Promise<ToolOutcome> {
    const tool = this.opts.registry.get(invocation.name);
    if (!tool) {
      return {
        toolCallId: invocation.toolCallId,
        name: invocation.name,
        ok: false,
        content: "",
        error: `tool not registered: ${invocation.name}`,
        durationMs: 0,
      };
    }

    const ctx: ToolContext = {
      logger: this.opts.logger,
      cwd: this.opts.cwd,
      allowedPaths: this.opts.allowedPaths,
      ...(invocation as { signal?: AbortSignal }).signal !== undefined
        ? { signal: (invocation as { signal?: AbortSignal }).signal }
        : {},
      timeoutMs: this.opts.defaultTimeoutMs ?? 30_000,
    };

    const startedAt = Date.now();

    // 阶段 H+2：审批流
    // - tool 在 forceRejectNames → 拒绝
    // - tool 在 forceApproveNames → 真执行（跳过 requiresApproval 检查）
    // - tool 有 requiresApproval=true 且不在 force approve set → 等用户决定
    const isForceApprove = this.opts.forceApproveNames?.includes(tool.name) === true ||
      this.opts.forceApproveAll === true;
    const isForceReject = this.opts.forceRejectNames?.includes(tool.name) === true;
    if (isForceReject) {
      const durationMs = Date.now() - startedAt;
      this.opts.logger.info("tool force-rejected", {
        tool: tool.name,
        toolCallId: invocation.toolCallId,
      });
      return {
        toolCallId: invocation.toolCallId,
        name: tool.name,
        ok: false,
        content: "",
        error: "USER_REJECTED",
        durationMs,
      };
    }
    if (tool.requiresApproval && !isForceApprove) {
      const durationMs = Date.now() - startedAt;
      this.opts.logger.info("tool awaiting approval", {
        tool: tool.name,
        toolCallId: invocation.toolCallId,
      });
      return {
        toolCallId: invocation.toolCallId,
        name: tool.name,
        ok: false,
        content: "",
        error: "APPROVAL_REQUIRED",
        durationMs,
        awaitingApproval: true,
      };
    }

    this.opts.logger.info("tool invoke", {
      tool: tool.name,
      toolCallId: invocation.toolCallId,
    });

    try {
      const args = invocation.args;
      const res = await this.runWithTimeout(tool, args, ctx);
      const durationMs = Date.now() - startedAt;
      if (res.ok) {
        this.opts.logger.info("tool ok", { tool: tool.name, durationMs });
        return {
          toolCallId: invocation.toolCallId,
          name: tool.name,
          ok: true,
          content: serializeToolResult(res.value),
          durationMs,
        };
      }
      this.opts.logger.warn("tool returned error", {
        tool: tool.name,
        error: res.error,
        durationMs,
      });
      return {
        toolCallId: invocation.toolCallId,
        name: tool.name,
        ok: false,
        content: "",
        error: res.error,
        durationMs,
      };
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const message = e instanceof Error ? e.message : String(e);
      this.opts.logger.error("tool threw", { tool: tool.name, error: message, durationMs });
      return {
        toolCallId: invocation.toolCallId,
        name: tool.name,
        ok: false,
        content: "",
        error: message,
        durationMs,
      };
    }
  }

  /** 并发执行多个工具调用（一次 assistant 消息里可能有多个 tool_use） */
  async executeAll(invocations: readonly ToolInvocation[]): Promise<ToolOutcome[]> {
    return await Promise.all(invocations.map((i) => this.executeOne(i)));
  }

  private async runWithTimeout(
    tool: Tool,
    args: unknown,
    ctx: ToolContext,
  ): Promise<Awaited<ReturnType<Tool["execute"]>>> {
    if (ctx.timeoutMs <= 0) {
      return await tool.execute(args, ctx);
    }
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(new Error(`tool ${tool.name} timed out after ${ctx.timeoutMs}ms`)),
      ctx.timeoutMs,
    );
    try {
      // 注意：tool 内部可以选择尊重 ctx.signal；这里仅做外层保险
      const execCtx: ToolContext = { ...ctx, signal: ac.signal };
      return await tool.execute(args, execCtx);
    } finally {
      clearTimeout(timer);
    }
  }
}

function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 防止 un-used 警告：ok/fail 公开，方便 builtin 工具使用 */
export { fail, ok };
