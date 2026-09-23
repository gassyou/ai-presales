/**
 * Tool —— AI 工具接口
 *
 * 工具是「AI 能调用的纯异步函数 + 元数据」。
 *   - 元数据：name / description / inputSchema（JSON Schema）/ requiresApproval / sideEffect
 *   - execute() 收到 args + ctx，返回结果
 *
 * 错误约定：
 *   - throw → ToolExecutor 包装为 DomainError TOOL_EXECUTION_FAILED
 *   - 返回 isError: true → 当作错误结果交给 LLM（不抛）
 */

import type { ToolCallId } from "@shared/types/ids.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export type SideEffect = "none" | "read" | "write" | "external";

export interface ToolContext {
  readonly logger: Logger;
  readonly cwd: string;
  readonly allowedPaths: readonly string[];
  readonly signal?: AbortSignal;
  /** 工具运行时间（ms）；executor 会做超时控制 */
  readonly timeoutMs: number;
}

export interface ToolOkResult<R> {
  readonly ok: true;
  readonly value: R;
}
export interface ToolErrResult {
  readonly ok: false;
  readonly error: string;
}
export type ToolResult<R> = ToolOkResult<R> | ToolErrResult;

export interface Tool<Args = unknown, R = unknown> {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for `args`; passed to LLM as tool definition */
  readonly inputSchema: Record<string, unknown>;
  /** 当 true 时，调用前需要用户审批（本期默认 false，留接口） */
  readonly requiresApproval: boolean;
  readonly sideEffect: SideEffect;
  execute(args: Args, ctx: ToolContext): Promise<ToolResult<R>>;
  /** 阶段 7.4h：可选运行时配置（被 ConfigurableToolRegistry 调）；未实现则静默跳过 */
  configure?(opts: Record<string, unknown>): void;
}

/** 工具调用请求（来自 LLM） */
export interface ToolInvocation {
  readonly toolCallId: ToolCallId;
  readonly name: string;
  /** 原始 args；可能是字符串（OpenAI）或对象（Anthropic/canonical） */
  readonly args: unknown;
}

/** 工具调用结果（用于回灌给 LLM） */
export interface ToolOutcome {
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly ok: boolean;
  readonly content: string;
  readonly error?: string;
  readonly durationMs: number;
}

export const ok = <R>(value: R): ToolResult<R> => ({ ok: true, value });
export const fail = <R = never>(error: string): ToolResult<R> => ({ ok: false, error });