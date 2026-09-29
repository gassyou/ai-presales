/**
 * ChatSession —— AI chat 会话聚合（阶段 6 / 任务 6）
 *
 * 一条会话 = 一次完整的"对话上下文"。可关联到项目（项目上下文）也可独立存在（全局对话）。
 * 包含 N 条消息（ChatMessage）。
 *
 * 关键约束：
 *   - title：首条消息的截断或用户自定义；>= 1 字符
 *   - project_id 可空（全局会话）
 *   - 消息按 created_at 升序排列
 */

import { type DomainResult, domainErr, domainOk } from "../shared/result.ts";
import type { ProjectId } from "@shared/types/ids.ts";

export type ChatMessageRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessageDTO {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly args?: unknown;
    readonly ok?: boolean;
    readonly result?: string;
    readonly error?: string;
    readonly durationMs?: number;
    readonly awaitingApproval?: boolean;
  }>;
  readonly createdAt: Date;
}

export interface ChatSessionDTO {
  readonly id: string;
  readonly projectId: ProjectId | null;
  readonly title: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ChatSession {
  constructor(
    public readonly id: string,
    public readonly projectId: ProjectId | null,
    public readonly title: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(args: {
    id: string;
    projectId: ProjectId | null;
    title: string;
    now: Date;
  }): DomainResult<ChatSession> {
    const title = args.title.trim();
    if (title.length === 0) {
      return domainErr("INVALID_INPUT", "title must be non-empty");
    }
    return domainOk(new ChatSession(args.id, args.projectId, title, args.now, args.now));
  }

  rename(newTitle: string): DomainResult<void> {
    const t = newTitle.trim();
    if (t.length === 0) {
      return domainErr("INVALID_INPUT", "title must be non-empty");
    }
    (this as { title: string }).title = t;
    return domainOk(undefined);
  }

  touch(now: Date): void {
    this.updatedAt = now;
  }

  toDTO(): ChatSessionDTO {
    return {
      id: this.id,
      projectId: this.projectId,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export const ChatMessageRoles = ["user", "assistant", "tool", "system"] as const;
