# AI 契约

## LLM 客户端抽象

```ts
interface ILLMClient {
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
  structured<T>(req: ChatRequest & { schema: JsonSchema }): Promise<StructuredResult<T>>;
  capabilities(): ProviderCapabilities;
}
```

- `chat` 同步返回，用于非流式 / 测试
- `stream` 推送流式事件（`chunk` / `tool_call` / `tool_result` / `done` / `error`）
- `structured` 用 provider 专属 JSON Schema 强制机制（OpenAI `response_format`、Anthropic tool use）

## Sub-Agent

```ts
interface SubAgentSpec {
  readonly name: string;
  readonly systemPrompt: string;
  readonly tools: readonly string[];        // 引用 ToolRegistry 中的 name
  readonly modelHint: { profile: string; overrideTemperature?: number; overrideMaxTokens?: number };
  readonly outputSchema?: JsonSchema;
}
```

不可变 record；工具函数不在 spec 里挂，由 ToolRegistry 在运行时解析。

## Tool

```ts
interface Tool<Args, Result> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly requiresApproval: boolean;
  readonly sideEffect: "none" | "read" | "write" | "external";
  execute(args: Args, ctx: ToolContext): Promise<Result>;
}
```

`ToolExecutor` 负责权限校验、超时、异常包装、日志。

## 流式事件

```
event: chunk      data: {"type":"chunk","delta":"你","messageId":"..."}
event: tool_call  data: {"type":"tool_call","toolCallId":"...","name":"read_file","args":{...}}
event: tool_result data: {"type":"tool_result","toolCallId":"...","ok":true,"result":...}
event: done       data: {"type":"done","messageId":"...","usage":{...}}
event: error      data: {"type":"error","code":"...","message":"...","retryable":false}
```

每个 `data:` 行是 `StreamEvent` JSON。客户端 fetch + ReadableStream 解析。

## Context 预算

```
total = contextWindow − reserve_for_output
├─ system_prompt         8%
├─ project_context       12%
├─ rag_hits              20%
├─ recent_history        50%
└─ user_input + files    10%
```

装配器：`backend/application/ai/assemble-context.ts`（纯函数）。

## 适配器一致性

所有 `ILLMClient` 实现必须通过同一份契约测试：
- 同样输入产生语义等价的 `ChatResult`
- 同样输入产生语义等价的 `StreamEvent` 序列（不强求 byte-equal）

差异在 `StreamNormalizer` 集中处理。
