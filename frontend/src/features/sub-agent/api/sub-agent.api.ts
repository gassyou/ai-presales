/**
 * SubAgent API —— 列表 + invoke（流式）
 */

import { http } from "@frontend/shared/api/http-client.ts";
import { postSse, readSse } from "@frontend/shared/api/sse-client.ts";
import { Endpoints } from "@frontend/shared/api/endpoints.ts";
import type { StreamEvent } from "@shared/types/dto/ai-session.ts";

export interface SubAgentDTO {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly toolNames: readonly string[];
  readonly profileHint?: string;
}

export interface SubAgentListResponse {
  readonly items: readonly SubAgentDTO[];
}

export interface SubAgentInvokeBody {
  readonly input: string;
  readonly profileName?: string;
  /** 阶段 6.0f：当前绑定项目 */
  readonly projectId?: string;
}

export const subAgentApi = {
  list() {
    return http.get<SubAgentListResponse>(Endpoints.subAgents);
  },

  async *invoke(name: string, payload: SubAgentInvokeBody, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const res = await postSse(Endpoints.subAgentInvoke(name), payload, signal ? { signal } : {});
    for await (const ev of readSse(res, signal)) {
      yield ev;
      if (ev.type === "done" || ev.type === "error") return;
    }
  },
};