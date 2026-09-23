/**
 * AnthropicClient —— Anthropic Messages API 适配器
 *
 * stream() 通过 transport.stream() 拿 raw chunks，再用 normalizeAnthropicChunk
 * 转成规范 StreamEvent。
 */

import type { ILLMClient } from "./llm-client.ts";
import type {
  CanonicalAssistantMessage,
  ChatRequest,
  ChatResult,
  ProviderCapabilities,
  StreamEvent,
} from "../message/canonical-message.ts";
import type { ITransport } from "../transport.ts";
import { LlmError } from "../transport.ts";
import {
  anthropicToCanonicalMessage,
  canonicalToAnthropicRequest,
  type AnthropicRequest,
  type AnthropicResponse,
} from "../message/adapters/anthropic.mapper.ts";
import {
  newNormalizerState,
  normalizeAnthropicChunk,
} from "../streaming/stream-normalizer.ts";

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  transport: ITransport;
  anthropicVersion?: string;
}

export class AnthropicClient implements ILLMClient {
  readonly provider = "anthropic" as const;
  private readonly opts: AnthropicClientOptions;
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly defaultMaxTokens: number;

  constructor(opts: AnthropicClientOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.version = opts.anthropicVersion ?? "2023-06-01";
    this.defaultMaxTokens = opts.maxTokens ?? 4096;
  }

  capabilities(): ProviderCapabilities {
    return {
      provider: "anthropic",
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      contextWindow: 200_000,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body = canonicalToAnthropicRequest({
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      model: req.model,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      tools: req.tools,
    });
    const res = await this.opts.transport.send<AnthropicResponse>({
      url: `${this.baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": this.version,
      },
      body,
      signal: req.signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw LlmError.fromStatus(res.status, res.body);
    }
    const canonical = anthropicToCanonicalMessage(res.body);
    return { message: canonical, raw: res.body };
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    const body = canonicalToAnthropicRequest({
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      model: req.model,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      tools: req.tools,
    });
    const stream = this.opts.transport.stream;
    if (!stream) {
      // 降级：用 chat 包装
      const r = await this.chat(req);
      const messageId = "msg_" + crypto.randomUUID();
      const text = extractText(r.message);
      if (text.length > 0) {
        yield { type: "chunk", delta: text, messageId };
      }
      for (const part of r.message.content) {
        if (part.type === "tool_use") {
          yield { type: "tool_call", toolCallId: part.toolCallId, name: part.name, args: part.args };
        }
      }
      yield { type: "done", messageId, usage: r.message.usage };
      return;
    }

    const state = newNormalizerState();
    for await (const raw of stream.call(this.opts.transport, {
      url: `${this.baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": this.version,
        "accept": "text/event-stream",
      },
      body,
      signal: req.signal,
    })) {
      for (const ev of normalizeAnthropicChunk(state, raw)) {
        yield ev;
        if (ev.type === "done" || ev.type === "error") return;
      }
    }
  }
}

function extractText(m: CanonicalAssistantMessage): string {
  return m.content
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}