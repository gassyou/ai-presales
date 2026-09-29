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
import { chatSessionApi } from "../api/chat-session.api.ts";
import { ApiError } from "@frontend/shared/api/http-client.ts";
import type { ProjectDTO } from "@shared/types/dto/project.ts";
import type { ChatMessage, ToolCallEntry } from "../types.ts";
import { useSkillStore } from "@frontend/features/skill/stores/skill.store.ts";
import { ElMessage } from "element-plus";

export const useAiChatStore = defineStore("aiChat", () => {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const profile = ref<string>("fast");
  /** 当前选中的 sub-agent；空 = 走直 chat */
  const subAgentName = ref<string>("");
  /** 阶段 H+2：chat store 内 force 决策（一组 tool 名）。
   *  setApprovePending(name) 把 name 加进 approve set；
   *  下次 send() 时把 forceApproveNames 注入 chat request body，executor 真执行该 tool。
   *  类似 rejectForce set。LLM 在下一轮如不再调那个 tool，决策自然过期。 */
  const pendingApprove = ref<Set<string>>(new Set());
  const pendingReject = ref<Set<string>>(new Set());
  /** 阶段 H：是否启用 chat 内 tools（带 toolNames 调 agent loop） */
  const toolsEnabled = ref<boolean>(false);
  /** 阶段 H：tools 名称集合（来自 ToolRegistry.names()，chat 启用时注入） */
  const toolNames = ref<string[]>([
    "read_module",
    "write_project_status",
    "create_activity",
    "create_function_list_item",
    "update_markdown_module",
    "save_questionnaire_outline",
    "set_primary_contact",
    "create_survey_task",
  ]);
  /** 阶段 H：当前绑定的项目（来自 ProjectDetailView）。null = 全局对话 */
  const currentProject = ref<ProjectDTO | null>(null);
  /** @ 项目候选池（来自 mention autocomplete） */
  const mentionCandidates = ref<ProjectDTO[]>([]);
  let inflightAbort: AbortController | null = null;

  function toRequestMessages(): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    return messages.value
      .filter((m): m is ChatMessage & { role: "system" | "user" | "assistant" } =>
        m.role !== "tool"
      )
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async function send(content: string): Promise<void> {
    if (content.trim().length === 0) return;
    // 阶段 13（PR #4）：在有项目上下文且无当前 session 时，自动建一条（不阻塞 send）。
    if (!currentSessionId.value && currentProject.value) {
      void createSessionForProject(currentProject.value.id).catch((e) =>
        console.warn("auto-create session failed", e)
      );
    }
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    messages.value = [...messages.value, userMsg];
    loading.value = true;
    error.value = null;
    // 持久化 user 消息到当前 session（无 session / 全局对话时 helper 内空操作）
    void persistMessage("user", userMsg.content);

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
      // 阶段 H+2：把 pending force 决策注入 body，并清空（一轮用完）
      const forceApproveNames = Array.from(pendingApprove.value);
      const forceRejectNames = Array.from(pendingReject.value);
      pendingApprove.value = new Set();
      pendingReject.value = new Set();

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
            ...(toolsEnabled.value ? { toolNames: toolNames.value } : {}),
            ...(forceApproveNames.length > 0 ? { forceApproveNames } : {}),
            ...(forceRejectNames.length > 0 ? { forceRejectNames } : {}),
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
          // 阶段 H+2：approval pending 推断（ok=false + error=APPROVAL_REQUIRED）
          const isAwaitingApproval = !ev.ok && ev.error === "APPROVAL_REQUIRED";
          messages.value = messages.value.map((m) => {
            if (m.id !== asstId) return m;
            const updated = (m.toolCalls ?? []).map((tc) =>
              tc.id === ev.toolCallId
                ? {
                  ...tc,
                  ok: ev.ok,
                  ...(ev.ok
                    ? {
                      result: typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result),
                    }
                    : {}),
                  ...(ev.error !== undefined ? { error: ev.error } : {}),
                  ...(isAwaitingApproval ? { awaitingApproval: true } : {}),
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
      // 阶段 13（PR #4）：流式结束后把完整 assistant 消息落盘（含 toolCalls）。
      const asstMsg = messages.value.find((m) => m.id === asstId);
      if (
        asstMsg &&
        (asstMsg.content.length > 0 || (asstMsg.toolCalls && asstMsg.toolCalls.length > 0))
      ) {
        void persistMessage(
          "assistant",
          asstMsg.content,
          asstMsg.toolCalls,
        );
      }
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = `${e.envelope.code}: ${e.envelope.message}`;
      } else if ((e as { name?: string }).name === "AbortError") {
        error.value = "已停止";
      } else {
        const err = e as { code?: string; message?: string };
        error.value = err.code
          ? `${err.code}: ${err.message ?? ""}`
          : (e instanceof Error ? e.message : String(e));
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

  /**
   * 阶段 9（任务 9）：从 /api/projects 拉取候选项目列表，给 ChatComposer @mention 用。
   * 前端在 mount 时调用；用户后续创建/删除项目时再调一次刷新。
   */

  // 阶段 5（任务 5）：会话管理
  /** 当前会话 id；null = 未选（默认新对话） */
  const currentSessionId = ref<string | null>(null);
  /** session 列表 */
  const sessions = ref<
    { id: string; projectId: string | null; title: string; createdAt: string; updatedAt: string }[]
  >([]);
  /** 加载会话列表（通常 mount 时） */
  async function loadSessions(projectId: string | null): Promise<void> {
    try {
      const list = await chatSessionApi.list(projectId);
      sessions.value = list;
    } catch (e) {
      console.warn("loadSessions failed", e);
    }
  }
  /**
   * 为某项目创建一个新会话；设 currentSessionId；清空 messages。
   */
  async function createSessionForProject(
    projectId: string | null,
    title?: string,
  ): Promise<string> {
    const titleText = title?.trim() || `新会话 ${new Date().toLocaleString("zh-CN")}`;
    const sess = await chatSessionApi.create({ projectId, title: titleText });
    sessions.value = [sess, ...sessions.value];
    currentSessionId.value = sess.id;
    messages.value = [];
    return sess.id;
  }
  async function switchToSession(id: string): Promise<void> {
    currentSessionId.value = id;
    const list = await chatSessionApi.listMessages(id);
    // 阶段 13（PR #4）：把 ChatMessageDTO 直接映射成本地 ChatMessage；role 是联合类型；
    // toolCalls 也按持久化形状回填（前端不再 `as never`）。
    messages.value = list.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      ...(m.toolCalls !== undefined
        ? { toolCalls: [...m.toolCalls] as unknown as ToolCallEntry[] }
        : {}),
    }));
  }
  /** 阶段 13（PR #7）：附件上传后端已自动 appendMessage；调此方法刷前端列表 */
  async function refreshMessages(sessionId: string): Promise<void> {
    if (currentSessionId.value !== sessionId) return;
    const list = await chatSessionApi.listMessages(sessionId);
    messages.value = list.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      ...(m.toolCalls !== undefined
        ? { toolCalls: [...m.toolCalls] as unknown as ToolCallEntry[] }
        : {}),
    }));
  }
  async function deleteCurrentSession(): Promise<void> {
    if (!currentSessionId.value) return;
    const id = currentSessionId.value;
    try {
      await chatSessionApi.remove(id);
    } catch (e) {
      console.warn("delete session failed", e);
    }
    sessions.value = sessions.value.filter((s) => s.id !== id);
    currentSessionId.value = null;
    messages.value = [];
  }
  /** 阶段 13（PR #4）：把一条消息持久化到当前 session（user / assistant 皆可）。失败仅 warn 不抛。 */
  async function persistMessage(
    role: "user" | "assistant" | "tool" | "system",
    content: string,
    toolCalls?: ReadonlyArray<ToolCallEntry>,
  ): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid) return; // 全局对话（无 projectId）暂不持久化
    try {
      await chatSessionApi.appendMessage({
        sessionId: sid,
        role,
        content,
        ...(toolCalls !== undefined && toolCalls.length > 0
          ? {
            toolCalls: toolCalls as unknown as Parameters<
              typeof chatSessionApi.appendMessage
            >[0]["toolCalls"],
          }
          : {}),
      });
    } catch (e) {
      console.warn("appendMessage failed", e);
    }
  }

  async function loadMentionCandidates(): Promise<void> {
    try {
      const { projectApi } = await import("@frontend/features/project/api/project.api.ts");
      const resp = await projectApi.list({ limit: 200 });
      setMentionCandidates(resp.items);
    } catch (e) {
      // 静默：@ 功能是辅助；列表空也不阻塞主流程
      console.warn("loadMentionCandidates failed", e);
    }
  }

  function setMentionCandidates(items: ProjectDTO[]): void {
    mentionCandidates.value = items;
  }

  /**
   * 阶段 13（PR #5）：执行一个 skill（不走 LLM；同步执行 + 落盘 user + assistant 两条消息）。
   * 调用前必须有 currentSessionId；没有则用当前项目建一条。
   */
  async function executeSkill(name: string, args: Record<string, unknown> = {}): Promise<void> {
    const skillStore = useSkillStore();
    // 确保有 session
    if (!currentSessionId.value && currentProject.value) {
      try {
        await createSessionForProject(currentProject.value.id);
      } catch (e) {
        ElMessage.error("创建会话失败：" + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
    if (!currentSessionId.value) {
      ElMessage.error("请先选择项目，再执行 skill");
      return;
    }

    const userText = `/skill ${name}${
      Object.keys(args).length > 0 ? " " + JSON.stringify(args) : ""
    }`;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
    };
    messages.value = [...messages.value, userMsg];
    void persistMessage("user", userText);

    loading.value = true;
    error.value = null;
    try {
      const resp = await skillStore.invoke(name, args);
      if (resp.ok) {
        const outputText = typeof resp.output === "string"
          ? resp.output
          : JSON.stringify(resp.output);
        const asstMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: outputText,
          createdAt: new Date().toISOString(),
        };
        messages.value = [...messages.value, asstMsg];
        void persistMessage("assistant", outputText);
      } else {
        ElMessage.error(`skill 失败：${resp.error}`);
        error.value = resp.error;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ElMessage.error(msg);
      error.value = msg;
    } finally {
      loading.value = false;
    }
  }

  return {
    messages,
    loading,
    error,
    profile,
    subAgentName,
    currentSessionId,
    sessions,
    toolsEnabled,
    toolNames,
    currentProject,
    mentionCandidates,
    send,
    stop,
    clear,
    setProfile,
    setSubAgent,
    setToolsEnabled: (v: boolean) => {
      toolsEnabled.value = v;
    },
    approveTool: (toolName: string) => {
      // 阶段 H+2：把 toolName 加入 forceApprove set；触发新一轮 send 让 LLM 重试。
      // 清掉同一 tool 的 reject 决策（以最后一次为准）。
      const r = new Set(pendingApprove.value);
      r.add(toolName);
      pendingApprove.value = r;
      const rj = new Set(pendingReject.value);
      rj.delete(toolName);
      pendingReject.value = rj;
    },
    rejectTool: (toolName: string) => {
      const rj = new Set(pendingReject.value);
      rj.add(toolName);
      pendingReject.value = rj;
      const r = new Set(pendingApprove.value);
      r.delete(toolName);
      pendingApprove.value = r;
    },
    pendingApprove,
    pendingReject,
    setCurrentProject,
    setCurrentProjectId,
    setMentionCandidates,
    loadSessions,
    createSessionForProject,
    switchToSession,
    deleteCurrentSession,
    persistMessage,
    loadMentionCandidates,
    executeSkill,
    refreshMessages,
  };
});
