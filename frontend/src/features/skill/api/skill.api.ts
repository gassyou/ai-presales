/**
 * skillApi —— 阶段 13（PR #5）
 *
 * 前端 fetch 封装，对应 backend /api/skills（list + invoke）。
 */
import { http } from "@frontend/shared/api/http-client.ts";

export interface SkillSummaryDTO {
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type SkillInvokeResponse =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export const skillApi = {
  /** 列出已注册的 skill（用于 slash popover） */
  async list(): Promise<SkillSummaryDTO[]> {
    const resp = await http.get<{ items: SkillSummaryDTO[] }>("/api/skills");
    return resp.items;
  },

  /** 同步调用 skill；返回 {ok, output} 或 {ok, error} */
  async invoke(name: string, args: Record<string, unknown>): Promise<SkillInvokeResponse> {
    return await http.post<SkillInvokeResponse>(
      `/api/skills/${encodeURIComponent(name)}/invoke`,
      { args },
    );
  },
};
