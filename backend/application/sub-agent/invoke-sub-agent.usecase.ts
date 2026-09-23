/**
 * InvokeSubAgentUseCase —— 调起 sub-agent 的用例
 *
 * 流程：
 *   1. 从 registry 找 spec；找不到 → throw NOT_FOUND
 *   2. 用 spec.profileHint 解析 ILLMClient（缺省用 AppConfig.defaultProfile）
 *   3. 从 ToolRegistry 解析 spec.toolNames → ToolSpec[]
 *   4. 构造 SubAgentRunner + ToolExecutor → 跑
 */

import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import type { SubAgentRegistryDeps, SubAgentRunOptions } from "./types.ts";
import { SubAgentRunner } from "@backend/ai/sub-agent/sub-agent-runner.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";

export class InvokeSubAgentUseCase {
  constructor(private readonly deps: SubAgentRegistryDeps) {}

  async execute(options: SubAgentRunOptions): Promise<AsyncIterable<StreamEvent>> {
    // 阶段 7.7：clientResolver 现在是 async；先 await 拿到 client，再起 stream
    const spec = this.deps.subAgentRegistry.get(options.subAgentName);
    if (!spec) {
      throw new Error(`sub-agent not found: ${options.subAgentName}`);
    }
    const profileName = spec.profileHint ?? options.profileName ?? this.deps.defaultProfileName;
    // 阶段 7.7：clientResolver 现在是 async（从 settings DB 取 profile → 构造 client）
    const client = await this.deps.clientResolver(profileName);

    // 从 ToolRegistry 取 spec.toolNames 对应的 ToolSpec
    const tools = options.tools;

    const executor = new ToolExecutor({
      registry: this.deps.toolRegistry,
      logger: this.deps.logger,
      cwd: this.deps.cwd,
      allowedPaths: this.deps.allowedPaths,
    });

    const runner = new SubAgentRunner({ client, executor, ...(this.deps.maxRounds !== undefined ? { maxRounds: this.deps.maxRounds } : {}) });
    return runner.run({
      spec,
      userInput: options.userInput,
      ...(options.history !== undefined ? { history: options.history } : {}),
      tools,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }
}