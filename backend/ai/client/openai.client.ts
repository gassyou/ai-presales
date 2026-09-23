/**
 * OpenAIClient —— OpenAI Chat Completions API 适配器
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
  canonicalToOpenAIRequest,
  openAIToCanonicalMessage,
  type OpenAIRequest,
  type OpenAIResponse,
} from "../message/adapters/openai.mapper.ts";
import { newNormalizerState, normalizeOpenAIChunk } from "../streaming/stream-normalizer.ts";

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  transport: ITransport;
}

export class OpenAIClient implements ILLMClient {
  readonly provider = "openai" as const;
  private readonly opts: OpenAIClientOptions;
  private readonly baseUrl: string;

  constructor(opts: OpenAIClientOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com";
  }

  capabilities(): ProviderCapabilities {
    return {
      provider: "openai",
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      contextWindow: 128_000,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body: OpenAIRequest = canonicalToOpenAIRequest({
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      model: req.model,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      tools: req.tools,
    });
    const res = await this.opts.transport.send<OpenAIResponse>({
      url: `${this.baseUrl}/v1/chat/completions`,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.opts.apiKey}`,
      },
      body,
      signal: req.signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw LlmError.fromStatus(res.status, res.body);
    }
    const canonical = openAIToCanonicalMessage(res.body);
    return { message: canonical, raw: res.body };
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    const body: OpenAIRequest = {
      ...canonicalToOpenAIRequest({
        systemPrompt: req.systemPrompt,
        messages: req.messages,
        model: req.model,
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        tools: req.tools,
      }),
      // 注入 stream:true 让 OpenAI 返回 SSE chunks
      stream: true,
    };
    const stream = this.opts.transport.stream;
    if (!stream) {
      const r = await this.chat(req);
      const messageId = "cmpl-" + crypto.randomUUID();
      const text = extractText(r.message);
      if (text.length > 0) yield { type: "chunk", delta: text, messageId };
      yield { type: "done", messageId, usage: r.message.usage };
      return;
    }

    const state = newNormalizerState();
    for await (const raw of stream.call(this.opts.transport, {
      url: `${this.baseUrl}/v1/chat/completions`,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.opts.apiKey}`,
        "accept": "text/event-stream",
      },
      body,
      signal: req.signal,
    })) {
      for (const ev of normalizeOpenAIChunk(state, raw)) {
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