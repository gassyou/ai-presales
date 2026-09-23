/**
 * ILLMClient —— LLM 客户端抽象
 *
 * 设计：
 *   - chat 同步返回 → 测试 / 非流式用例
 *   - stream 异步可迭代 → 阶段 4 SSE 用
 *   - capabilities 静态 → 启动期做路由 / 降级判断
 *
 * 适配器必须通过同一份契约测试（tests/unit/ai/llm-client.contract.test.ts）。
 * 不同适配器行为差异集中在 mapper 与 normalizer，不外泄到调用方。
 */

import type {
  ChatRequest,
  ChatResult,
  ProviderCapabilities,
  StreamEvent,
} from "../message/canonical-message.ts";

export interface ILLMClient {
  readonly provider: "openai" | "anthropic";
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
  capabilities(): ProviderCapabilities;
}