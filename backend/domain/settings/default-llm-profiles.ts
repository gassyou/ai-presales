/**
 * 默认 LLM profiles（阶段 7.7 启动期 seed 用）
 *
 * 设计：apiKey / model / baseUrl 全空 —— **不内置任何 provider URL**。
 * 启动期种到 settings DB 后，用户首次进入 Settings → Models 看到的是"待填"状态，
 * 提示"请填入 baseUrl、apiKey、model"。
 *
 * provider 选 openai（更通用，OpenAI 兼容协议覆盖 Anthropic via 代理 / 本地 ollama）。
 * 若用户配 Anthropic-native，把 provider 切到 "anthropic" 即可。
 */

import type { LLMProfilesSettingData } from "./llm-profiles.setting.ts";

export const DEFAULT_LLM_PROFILES: LLMProfilesSettingData = {
  defaultProfile: "default",
  profiles: [
    {
      name: "default",
      provider: "openai",
      baseUrl: "",  // 用户必填 —— 例 https://api.openai.com/v1 / https://api.anthropic.com/v1 / http://localhost:11434/v1
      apiKey: "",   // 用户必填
      model: "",    // 用户必填 —— 例 gpt-4o / claude-sonnet-4-5 / qwen2.5:14b
      temperature: 0.7,
      maxTokens: 4096,
    },
  ],
};