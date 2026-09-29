/**
 * AutoModeRunnerAdapter —— 把 InvokeSubAgentUseCase 包成 SubAgentRunner 形状
 *
 * 目的：
 *   - SubAgentAutoModeWorker + SubAgentReviewer 依赖 SubAgentRunner.sync 接口
 *     (new SubAgentRunner({client, executor}) + runner.run({spec, userInput, tools}))
 *   - 但启动期 clientResolver 是 async；SubAgentRunner 构造需要 sync ILLMClient
 *   - adapter 通过 wrap InvokeSubAgentUseCase.execute 来延迟 client 解析，
 *     每次 worker/reviewer 调 run() 时才异步拿 client
 *
 * 行为契约：
 *   - adapter.run() 同步返回一个 AsyncIterable<StreamEvent>；真正的 invoke 在第一次
 *     next() 时触发。这样 worker/reviewer 的 `for await (const ev of runner.run(...))`
 *     不用改就能工作。
 */
import type { SubAgentRunInput, SubAgentRunner } from "@backend/ai/sub-agent/sub-agent-runner.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import type { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { InvokeSubAgentUseCase } from "@backend/application/sub-agent/invoke-sub-agent.usecase.ts";

export interface AutoModeRunnerAdapterDeps {
  readonly invokeUseCase: InvokeSubAgentUseCase;
  readonly toolRegistry: ToolRegistry;
}

export class AutoModeRunnerAdapter {
  constructor(private readonly deps: AutoModeRunnerAdapterDeps) {}

  /**
   * 同步返回 AsyncIterable<StreamEvent>；底层 promise 在第一次 next() 时才触发。
   * （invokeUseCase.execute 必须延迟——它在调用时同步开始 client 解析）
   */
  run(input: SubAgentRunInput): AsyncIterable<StreamEvent> {
    const invokeUseCase = this.deps.invokeUseCase;
    const toolRegistry = this.deps.toolRegistry;
    const subAgentName = input.spec.name;
    const tools = input.spec.toolNames.flatMap((name) => {
      const t = toolRegistry.get(name);
      return t ? [{ name: t.name, description: t.description, inputSchema: t.inputSchema }] : [];
    });
    const argsForInvoke = {
      subAgentName,
      userInput: input.userInput,
      tools,
      ...(input.history !== undefined
        ? {
          history: input.history as Parameters<typeof invokeUseCase.execute>[0]["history"],
        }
        : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    };

    return {
      [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        let started = false;
        let inner: AsyncIterator<StreamEvent> | null = null;
        let pending: Promise<void> | null = null;
        return {
          async next(): Promise<IteratorResult<StreamEvent>> {
            if (!started) {
              started = true;
              // 第一次 next() 才触发 execute —— run() 本身零开销
              const promise = invokeUseCase.execute(argsForInvoke);
              pending = (async () => {
                const iterable = await promise;
                inner = iterable[Symbol.asyncIterator]();
              })();
            }
            if (pending) await pending;
            return inner!.next();
          },
        };
      },
    };
  }
}

/** adapter 是 SubAgentRunner 的结构子集（仅 .run）—— TS 结构兼容。 */
// deno-lint-ignore no-explicit-any
export function asSubAgentRunner(adapter: AutoModeRunnerAdapter): SubAgentRunner {
  return adapter as unknown as SubAgentRunner;
}
