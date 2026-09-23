/**
 * LLMClientResolver —— 阶段 7.4h
 *
 * 替换 main.ts:107-122 的 clientCache + resolveClient() 闭包。
 *
 * 设计：
 *   - 持 Map<profileName, ILLMClient> cache
 *   - get(name) 命中返回；未命中调 build(name) 构造
 *   - invalidate(name?) 清空缓存（settings 改了之后调）
 *
 * 注意：build 是延迟构造依赖工厂；不持有任何外部状态。settings 改了之后调 invalidate，
 * 下一次 get 重新走 createLlmClient(...)，用到最新的 settings + env。
 *
 * 阶段 7.7：build 现在是 async（settings DB 是异步），get 也变成 async。
 */

import type { ILLMClient } from "@backend/ai/client/llm-client.ts";

export class LLMClientResolver {
  private cache = new Map<string, ILLMClient>();
  private inflight = new Map<string, Promise<ILLMClient>>();

  constructor(private readonly build: (name: string) => Promise<ILLMClient>) {}

  async get(profileName: string): Promise<ILLMClient> {
    const cached = this.cache.get(profileName);
    if (cached) return cached;
    const pending = this.inflight.get(profileName);
    if (pending) return pending;
    const p = this.build(profileName).then((c) => {
      this.cache.set(profileName, c);
      this.inflight.delete(profileName);
      return c;
    }).catch((e) => {
      this.inflight.delete(profileName);
      throw e;
    });
    this.inflight.set(profileName, p);
    return p;
  }

  invalidate(profileName?: string): void {
    if (profileName !== undefined) {
      this.cache.delete(profileName);
    } else {
      this.cache.clear();
    }
  }

  /** 仅测试用 —— 当前 cache 大小 */
  size(): number {
    return this.cache.size;
  }
}