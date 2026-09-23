/**
 * LLM 客户端工厂 —— 根据 settings DB 中的 profile 创建适配器
 *
 * 工厂返回 ILLMClient，依赖：
 *   - profile (provider, model, baseUrl, apiKey) —— 由 LLMClientResolver 通过 settings 注入
 *   - 注入 transport（生产走真实 SDK-based transport，测试走 fake）
 *
 * apiKey 优先 env 注入（process.env / Deno.env.get），然后 settings。
 */

import type { LLMProfileConfig } from "@backend/domain/settings/llm-profiles.setting.ts";
import type { ILLMClient } from "./llm-client.ts";
import { AnthropicClient, type AnthropicClientOptions } from "./anthropic.client.ts";
import { OpenAIClient, type OpenAIClientOptions } from "./openai.client.ts";
import type { ITransport } from "../transport.ts";

export interface ClientFactoryDeps {
  /**
   * 阶段 7.7：从 settings DB 异步取 profile。返回 undefined 表示未配置。
   * 之所以用闭包 + 异步而非直接传 profile，是为了：
   *   1. 启动期 settings 尚未 seed 时仍可解析（resolver 内部缓存）
   *   2. 支持 hot-reload：settings 改 → invalidate resolver → 下次调用拿最新值
   */
  getProfile: (name: string) => Promise<LLMProfileConfig | undefined>;
  transport: ITransport;
  /** env 注入函数，便于测试 mock */
  env: Record<string, string | undefined>;
}

export async function createLlmClient(profileName: string, deps: ClientFactoryDeps): Promise<ILLMClient> {
  const profile = await deps.getProfile(profileName);
  if (!profile) {
    throw new Error(
      `unknown LLM profile: "${profileName}". ` +
        `Please visit Settings → Models to add it.`,
    );
  }
  const apiKey = resolveApiKey(profile, deps.env);
  if (!apiKey || apiKey.length === 0) {
    throw new Error(
      `LLM profile "${profileName}" has no API key configured. ` +
        `Please visit Settings → Models to add an API key.`,
    );
  }

  switch (profile.provider) {
    case "anthropic": {
      const opts: AnthropicClientOptions = {
        apiKey,
        model: profile.model,
        maxTokens: profile.maxTokens,
        transport: deps.transport,
      };
      if (profile.baseUrl) opts.baseUrl = profile.baseUrl;
      return new AnthropicClient(opts);
    }
    case "openai": {
      const opts: OpenAIClientOptions = {
        apiKey,
        model: profile.model,
        transport: deps.transport,
      };
      if (profile.baseUrl) opts.baseUrl = profile.baseUrl;
      return new OpenAIClient(opts);
    }
  }
}

function resolveApiKey(
  profile: LLMProfileConfig,
  env: Record<string, string | undefined>,
): string | undefined {
  const provider = profile.provider.toUpperCase();
  const envKey = env[`${provider}_API_KEY`];
  if (envKey && envKey.length > 0) return envKey;
  return profile.apiKey;
}