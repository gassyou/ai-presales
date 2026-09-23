/**
 * SdkTransport —— 真实 SDK 网络层
 *
 * stream() 走 SDK 的 stream 接口，让 SDK 处理 SSE 拼帧 / 重连。
 */

import type { ITransport, TransportRequest, TransportResponse } from "./transport.ts";
import { LlmError } from "./transport.ts";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "@openai/openai";

export interface SdkTransportOptions {
  anthropicKey?: string;
  openaiKey?: string;
}

export class SdkTransport implements ITransport {
  private readonly opts: SdkTransportOptions;
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  constructor(opts: SdkTransportOptions) {
    this.opts = opts;
    if (opts.anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: opts.anthropicKey });
    }
    if (opts.openaiKey) {
      this.openai = new OpenAI({ apiKey: opts.openaiKey });
    }
  }

  async send<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    if (req.url.includes("anthropic.com")) {
      return await this.sendAnthropic<T>(req);
    }
    if (req.url.includes("openai.com") || req.url.includes("/v1/chat/completions")) {
      return await this.sendOpenAI<T>(req);
    }
    throw new LlmError("LLM_INTERNAL", `unsupported URL: ${req.url}`, false);
  }

  async *stream(req: TransportRequest): AsyncIterable<unknown> {
    if (req.url.includes("anthropic.com")) {
      yield* this.streamAnthropic(req);
      return;
    }
    if (req.url.includes("openai.com") || req.url.includes("/v1/chat/completions")) {
      yield* this.streamOpenAI(req);
      return;
    }
    throw new LlmError("LLM_INTERNAL", `unsupported URL: ${req.url}`, false);
  }

  private async *streamAnthropic(req: TransportRequest): AsyncIterable<unknown> {
    if (!this.anthropic) {
      throw new LlmError("LLM_AUTH_FAILED", "anthropic api key not configured", false);
    }
    const body = req.body as Parameters<Anthropic["messages"]["create"]>[0];
    try {
      const stream = this.anthropic.messages.stream(body, { signal: req.signal });
      for await (const ev of stream) {
        yield ev;
      }
    } catch (e) {
      throw this.normalizeAnthropicError(e);
    }
  }

  private async *streamOpenAI(req: TransportRequest): AsyncIterable<unknown> {
    if (!this.openai) {
      throw new LlmError("LLM_AUTH_FAILED", "openai api key not configured", false);
    }
    const body = req.body as Parameters<OpenAI["chat"]["completions"]["create"]>[0];
    try {
      // 强制走 streaming 重载（返回 Stream<ChatCompletionChunk>），即便 body 没带 stream:true
      const streamParams = { ...body, stream: true } as unknown as Parameters<
        OpenAI["chat"]["completions"]["create"]
      >[0];
      const result = await this.openai.chat.completions.create(streamParams, { signal: req.signal });
      // 运行时：result 是 Stream<ChatCompletionChunk>（因为传了 stream:true）
      if (result instanceof ReadableStream || Symbol.asyncIterator in Object(result)) {
        for await (const chunk of result as AsyncIterable<unknown>) {
          yield chunk;
        }
      } else {
        // 防御性兜底：SDK 仍然返回了非流式
        yield result;
      }
    } catch (e) {
      throw this.normalizeOpenAIError(e);
    }
  }

  private async sendAnthropic<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    if (!this.anthropic) {
      throw new LlmError("LLM_AUTH_FAILED", "anthropic api key not configured", false);
    }
    try {
      const body = req.body as {
        model: string;
        max_tokens: number;
        temperature?: number;
        system?: string | Array<{ type: "text"; text: string }>;
        tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
        messages: Array<{ role: "user" | "assistant"; content: unknown }>;
      };
      const createParams: Parameters<Anthropic["messages"]["create"]>[0] = {
        model: body.model,
        max_tokens: body.max_tokens,
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        messages: body.messages as Parameters<Anthropic["messages"]["create"]>[0]["messages"],
        ...(body.system !== undefined ? { system: body.system } : {}),
        ...(body.tools !== undefined ? { tools: body.tools as Parameters<Anthropic["messages"]["create"]>[0]["tools"] } : {}),
      };
      const result = await this.anthropic.messages.create(createParams);
      return { status: 200, body: result as unknown as T };
    } catch (e) {
      throw this.normalizeAnthropicError(e);
    }
  }

  private async sendOpenAI<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    if (!this.openai) {
      throw new LlmError("LLM_AUTH_FAILED", "openai api key not configured", false);
    }
    try {
      const body = req.body as {
        model: string;
        temperature?: number;
        max_tokens?: number;
        messages: unknown[];
        tools?: unknown[];
      };
      const createParams: Parameters<OpenAI["chat"]["completions"]["create"]>[0] = {
        model: body.model,
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
        messages: body.messages as Parameters<OpenAI["chat"]["completions"]["create"]>[0]["messages"],
        ...(body.tools !== undefined ? { tools: body.tools as Parameters<OpenAI["chat"]["completions"]["create"]>[0]["tools"] } : {}),
      };
      const result = await this.openai.chat.completions.create(createParams);
      return { status: 200, body: result as unknown as T };
    } catch (e) {
      throw this.normalizeOpenAIError(e);
    }
  }

  private normalizeAnthropicError(e: unknown): LlmError {
    if (e instanceof Error) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return new LlmError("LLM_AUTH_FAILED", e.message, false, status);
      if (status === 429) return new LlmError("LLM_RATE_LIMIT", e.message, true, status);
      if (status === 400) return new LlmError("LLM_BAD_REQUEST", e.message, false, status);
      if (status !== undefined && status >= 500) return new LlmError("LLM_UPSTREAM_ERROR", e.message, true, status);
    }
    return new LlmError("LLM_INTERNAL", e instanceof Error ? e.message : String(e), false);
  }

  private normalizeOpenAIError(e: unknown): LlmError {
    if (e instanceof Error) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return new LlmError("LLM_AUTH_FAILED", e.message, false, status);
      if (status === 429) return new LlmError("LLM_RATE_LIMIT", e.message, true, status);
      if (status === 400) return new LlmError("LLM_BAD_REQUEST", e.message, false, status);
      if (status !== undefined && status >= 500) return new LlmError("LLM_UPSTREAM_ERROR", e.message, true, status);
    }
    return new LlmError("LLM_INTERNAL", e instanceof Error ? e.message : String(e), false);
  }
}