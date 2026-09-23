/**
 * StreamChatUseCase —— 流式 chat
 *
 * 与 ChatUseCase 的差别：返回 AsyncIterable，让 presentation 层直接绑到 SSE。
 * ILLMClient.stream 已经返回归一化的 StreamEvent，无需额外映射。
 */

import type {
  CanonicalMessage,
  ChatRequest,
  StreamEvent,
  ToolSpec,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";

export interface StreamChatInput {
  readonly profile: ProfileConfig;
  readonly messages: readonly CanonicalMessage[];
  readonly systemPrompt?: string;
  readonly tools?: readonly ToolSpec[];
  readonly signal?: AbortSignal;
}

export class StreamChatUseCase {
  constructor(private readonly client: ILLMClient) {}

  execute(input: StreamChatInput): AsyncIterable<StreamEvent> {
    const req: ChatRequest = {
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      model: input.profile.model,
      temperature: input.profile.temperature,
      maxOutputTokens: input.profile.maxTokens,
      tools: input.tools,
      signal: input.signal,
    };
    return this.client.stream(req);
  }
}