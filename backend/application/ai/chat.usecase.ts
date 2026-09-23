/**
 * ChatUseCase —— 单次 chat 调用（同步返回）
 *
 * 阶段 3：单轮 chat，组装系统 prompt + 用户消息，调 ILLMClient.chat
 * 阶段 4：流式 variant
 *
 * 错误透传 LlmError → 由 presentation 翻译为 ErrorEnvelope
 */

import type {
  CanonicalMessage,
  ChatRequest,
  ChatResult,
  ToolSpec,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";

export interface ChatInput {
  readonly profile: ProfileConfig;
  readonly messages: readonly CanonicalMessage[];
  readonly systemPrompt?: string;
  readonly tools?: readonly ToolSpec[];
  readonly signal?: AbortSignal;
}

export class ChatUseCase {
  constructor(private readonly client: ILLMClient) {}

  async execute(input: ChatInput): Promise<ChatResult> {
    const req: ChatRequest = {
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      model: input.profile.model,
      temperature: input.profile.temperature,
      maxOutputTokens: input.profile.maxTokens,
      tools: input.tools,
      signal: input.signal,
    };
    return await this.client.chat(req);
  }
}