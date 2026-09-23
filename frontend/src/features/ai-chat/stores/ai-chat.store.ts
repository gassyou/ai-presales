/**
 * AIChatStore —— Pinia store，集中聊天消息 + 发送
 *
 * 阶段 4：默认走流式端点；逐 chunk 追加到 assistant 消息。
 * 阶段 5：可选 sub-agent 路由；tool_call / tool_result 渲染到 message.toolCalls
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import { aiChatApi } from "../api/ai-chat.api.ts";
import { subAgentApi } from "@frontend/features/sub-agent/api/sub-agent.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";
import type { ChatMessage, ToolCallEntry } from "../types.ts";

export const useAiChatStore = defineStore("aiChat", () => {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const profile = ref<string>("fast");
  /** 当前选中的 sub-agent；空 = 走直 chat */
  const subAgentName = ref<string>("");
  /** 阶段 6.0f：当前绑定的项目（来自 ProjectDetailView）。null = 全局对话 */
  const currentProject = ref<ProjectDTO | null>(null);
  /** @ 项目候选池（来自 mention autocomplete） */
  const mentionCandidates = ref<ProjectDTO[]>([]);
  let inflightAbort: AbortController | null = null;

  function toRequestMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return messages.value
      .filter((m): m is ChatMessage & { role: "system" | "user" | "assistant" } => m.role !== "tool")
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async function send(content: string): Promise<void> {
    if (content.trim().length === 0) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    messages.value = [...messages.value, userMsg];
    loading.value = true;
    error.value = null;

    const abort = new AbortController();
    inflightAbort = abort;

    const asstId = crypto.randomUUID();
    messages.value = [
      ...messages.value,
      {
        id: asstId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        toolCalls: [],
      },
    ];

    try {
      const source = subAgentName.value
        ? subAgentApi.invoke(
          subAgentName.value,
          {
            input: content,
            ...(profile.value ? { profileName: profile.value } : {}),
            ...(currentProject.value ? { projectId: currentProject.value.id } : {}),
          },
          abort.signal,
        )
        : aiChatApi.streamChat(
          {
            profile: profile.value,
            messages: toRequestMessages(),
            ...(currentProject.value ? { projectId: currentProject.value.id } : {}),
          },
          abort.signal,
        );

      for await (const ev of source) {
        if (ev.type === "chunk") {
          messages.value = messages.value.map((m) =>
            m.id === asstId ? { ...m, content: m.content + ev.delta } : m
          );
        } else if (ev.type === "tool_call") {
          const entry: ToolCallEntry = {
            id: ev.toolCallId,
            name: ev.name,
            args: ev.args,
            durationMs: 0,
          };
          messages.value = messages.value.map((m) =>
            m.id === asstId ? { ...m, toolCalls: [...(m.toolCalls ?? []), entry] } : m
          );
        } else if (ev.type === "tool_result") {
          messages.value = messages.value.map((m) => {
            if (m.id !== asstId) return m;
            const updated = (m.toolCalls ?? []).map((tc) =>
              tc.id === ev.toolCallId
                ? {
                  ...tc,
                  ok: ev.ok,
                  ...(ev.ok
                    ? { result: typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result) }
                    : {}),
                  ...(ev.error !== undefined ? { error: ev.error } : {}),
                  durationMs: ev.durationMs,
                }
                : tc
            );
            return { ...m, toolCalls: updated };
          });
        } else if (ev.type === "error") {
          error.value = `${ev.code}: ${ev.message}`;
        }
      }
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = `${e.envelope.code}: ${e.envelope.message}`;
      } else if ((e as { name?: string }).name === "AbortError") {
        error.value = "已停止";
      } else {
        const err = e as { code?: string; message?: string };
        error.value = err.code ? `${err.code}: ${err.message ?? ""}` : (e instanceof Error ? e.message : String(e));
      }
    } finally {
      loading.value = false;
      if (inflightAbort === abort) inflightAbort = null;
    }
  }

  function stop(): void {
    if (inflightAbort) {
      inflightAbort.abort();
      inflightAbort = null;
    }
    loading.value = false;
  }

  function clear(): void {
    stop();
    messages.value = [];
    error.value = null;
  }

  function setProfile(p: string): void {
    profile.value = p;
  }

  function setSubAgent(name: string): void {
    subAgentName.value = name;
  }

  /** 阶段 6.0f：绑定项目（ProjectDetailView 进入时） */
  function setCurrentProject(p: ProjectDTO | null): void {
    currentProject.value = p;
  }
  function setCurrentProjectId(id: string): void {
    if (currentProject.value?.id === id) return;
    // 轻量：只存 id；详情通过 projectApi.get 异步补全（路由层负责）
    currentProject.value = { ...(currentProject.value ?? {} as ProjectDTO), id } as ProjectDTO;
  }
  function setMentionCandidates(items: ProjectDTO[]): void {
    mentionCandidates.value = items;
  }

  return {
    messages,
    loading,
    error,
    profile,
    subAgentName,
    currentProject,
    mentionCandidates,
    send,
    stop,
    clear,
    setProfile,
    setSubAgent,
    setCurrentProject,
    setCurrentProjectId,
    setMentionCandidates,
  };
});