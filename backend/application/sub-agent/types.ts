/**
 * sub-agent 应用层共享类型
 *
 * 抽出来避免 InvokeSubAgentUseCase 与 ListSubAgentsUseCase 循环依赖
 */

import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { IToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import type { CanonicalMessage, ToolSpec } from "@backend/ai/message/canonical-message.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

export interface SubAgentRegistryDeps {
  readonly subAgentRegistry: ISubAgentRegistry;
  readonly toolRegistry: IToolRegistry;
  /**
   * 阶段 7.7：异步解析 profile 名字 → ILLMClient（从 settings DB 读 profile）。
   * 调用方负责单次调用 resolveClient 的幂等性 / 缓存策略（一般用 LLMClientResolver 包装）。
   */
  readonly clientResolver: (profileName: string) => Promise<ILLMClient>;
  readonly logger: Logger;
  readonly cwd: string;
  readonly allowedPaths: readonly string[];
  readonly defaultProfileName: string;
  readonly maxRounds?: number;
}

export interface SubAgentRunOptions {
  readonly subAgentName: string;
  readonly userInput: string;
  readonly profileName?: string;
  readonly history?: readonly CanonicalMessage[];
  readonly tools: readonly ToolSpec[];
  readonly signal?: AbortSignal;
}