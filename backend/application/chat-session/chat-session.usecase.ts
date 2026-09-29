/**
 * ChatSessionUseCase —— 阶段 6 / 任务 6
 *
 * 简化的会话 CRUD：业务规则薄（不需要聚合根），直接走 IChatSessionRepository。
 */

import type { Clock } from "@backend/domain/shared/clock.ts";
import { domainErr, domainOk, type DomainResult } from "@backend/domain/shared/result.ts";
import {
  type ChatMessageDTO,
  ChatSession,
  type ChatSessionDTO,
} from "@backend/domain/chat-session/chat-session.ts";
import type { IChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import type { ProjectId } from "@shared/types/ids.ts";

export interface ChatSessionUseCaseDeps {
  readonly repo: IChatSessionRepository;
  readonly clock: Clock;
  /** 注入一个 UUID 生成器（测试用） */
  readonly idGen?: () => string;
}

function defaultIdGen(): string {
  return crypto.randomUUID();
}

export class ChatSessionUseCase {
  private readonly idGen: () => string;
  constructor(private readonly deps: ChatSessionUseCaseDeps) {
    this.idGen = deps.idGen ?? defaultIdGen;
  }

  createSession(args: {
    projectId: ProjectId | null;
    title: string;
  }): DomainResult<ChatSessionDTO> {
    const r = ChatSession.create({
      id: this.idGen(),
      projectId: args.projectId,
      title: args.title,
      now: this.deps.clock.now(),
    });
    if (!r.ok) return r;
    this.deps.repo.createSession(r.value);
    return domainOk(r.value.toDTO());
  }

  listSessionsByProject(projectId: ProjectId | null): ChatSessionDTO[] {
    return this.deps.repo.listSessionsByProject(projectId);
  }

  listAllSessions(): ChatSessionDTO[] {
    return this.deps.repo.listAllSessions();
  }

  renameSession(id: string, newTitle: string): DomainResult<ChatSessionDTO> {
    const existing = this.deps.repo.findSessionById(id);
    if (!existing) return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    if (!this.deps.repo.renameSession(id, newTitle)) {
      return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    }
    const refreshed = this.deps.repo.findSessionById(id);
    if (!refreshed) return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    refreshed.touch(this.deps.clock.now());
    return domainOk(refreshed.toDTO());
  }

  /** 阶段 13（PR #8）：切换会话级"全部自动批准工具"开关。 */
  setAutoApprove(id: string, on: boolean): DomainResult<ChatSessionDTO> {
    const existing = this.deps.repo.findSessionById(id);
    if (!existing) return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    if (!this.deps.repo.setAutoApprove(id, on)) {
      return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    }
    existing.setAutoApprove(on);
    existing.touch(this.deps.clock.now());
    return domainOk(existing.toDTO());
  }

  deleteSession(id: string): DomainResult<void> {
    const ok = this.deps.repo.deleteSession(id);
    if (!ok) return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    return domainOk(undefined);
  }

  getSession(id: string): DomainResult<ChatSessionDTO> {
    const s = this.deps.repo.findSessionById(id);
    if (!s) return domainErr("NOT_FOUND", `chat session not found: ${id}`);
    return domainOk(s.toDTO());
  }

  appendMessage(args: {
    sessionId: string;
    role: ChatMessageDTO["role"];
    content: string;
    toolCalls?: ChatMessageDTO["toolCalls"];
  }): DomainResult<ChatMessageDTO> {
    const session = this.deps.repo.findSessionById(args.sessionId);
    if (!session) return domainErr("NOT_FOUND", `chat session not found: ${args.sessionId}`);
    const msg: ChatMessageDTO = {
      id: this.idGen(),
      sessionId: args.sessionId,
      role: args.role,
      content: args.content,
      ...(args.toolCalls !== undefined ? { toolCalls: args.toolCalls } : {}),
      createdAt: this.deps.clock.now(),
    };
    this.deps.repo.appendMessage(msg);
    session.touch(msg.createdAt);
    return domainOk(msg);
  }

  listMessages(sessionId: string): DomainResult<ChatMessageDTO[]> {
    const session = this.deps.repo.findSessionById(sessionId);
    if (!session) return domainErr("NOT_FOUND", `chat session not found: ${sessionId}`);
    return domainOk(this.deps.repo.listMessages(sessionId));
  }
}
