/**
 * chatSessionApi —— 阶段 5/6（任务 5/6）
 *
 * 前端 fetch 封装，对应 backend /api/chat/sessions[/...]。
 */
import { http } from "@frontend/shared/api/http-client.ts";

export interface ChatSessionDTO {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 阶段 13（PR #8）：会话级"全部自动批准工具"开关 */
  autoApprove: boolean;
}

export interface ChatMessageDTO {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: ReadonlyArray<{
    id: string;
    name: string;
    args?: unknown;
    ok?: boolean;
    result?: string;
    error?: string;
    durationMs?: number;
    awaitingApproval?: boolean;
  }>;
  createdAt: string;
}

export const chatSessionApi = {
  /** 列出 session（可按项目过滤；null = 全局） */
  async list(projectId: string | null): Promise<ChatSessionDTO[]> {
    const url = projectId === null
      ? "/api/chat/sessions"
      : `/api/chat/sessions?projectId=${encodeURIComponent(projectId)}`;
    const resp = await http.get<{ items: ChatSessionDTO[] }>(url);
    return resp.items;
  },

  async create(input: { projectId: string | null; title: string }): Promise<ChatSessionDTO> {
    return await http.post<ChatSessionDTO>("/api/chat/sessions", input);
  },

  async rename(id: string, title: string): Promise<ChatSessionDTO> {
    return await http.patch<ChatSessionDTO>(`/api/chat/sessions/${id}`, { title });
  },

  /** 阶段 13（PR #8）：设置会话级"全部自动批准"开关 */
  async setAutoApprove(id: string, on: boolean): Promise<ChatSessionDTO> {
    return await http.patch<ChatSessionDTO>(`/api/chat/sessions/${id}`, { autoApprove: on });
  },

  async remove(id: string): Promise<void> {
    await http.del<void>(`/api/chat/sessions/${id}`);
  },

  async listMessages(sessionId: string): Promise<ChatMessageDTO[]> {
    const resp = await http.get<{ items: ChatMessageDTO[] }>(
      `/api/chat/sessions/${sessionId}/messages`,
    );
    return resp.items;
  },

  async appendMessage(input: {
    sessionId: string;
    role: ChatMessageDTO["role"];
    content: string;
    toolCalls?: ChatMessageDTO["toolCalls"];
  }): Promise<ChatMessageDTO> {
    return await http.post<ChatMessageDTO>(
      `/api/chat/sessions/${input.sessionId}/messages`,
      input,
    );
  },
};
