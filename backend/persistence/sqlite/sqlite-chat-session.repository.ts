/**
 * SqliteChatSessionRepository —— 阶段 6 / 任务 6
 *
 * chat_sessions + chat_messages 表的 SQLite 实现。
 * 注意：写入 chat_messages 会自动 touch chat_sessions.updated_at。
 */

import {
  ChatMessageDTO,
  ChatMessageRoles,
  ChatSession,
  ChatSessionDTO,
} from "@backend/domain/chat-session/chat-session.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import type { Database } from "@backend/persistence/database/database.ts";

export interface IChatSessionRepository {
  createSession(s: ChatSession): void;
  findSessionById(id: string): ChatSession | null;
  listSessionsByProject(projectId: ProjectId | null, limit?: number): ChatSessionDTO[];
  listAllSessions(limit?: number): ChatSessionDTO[];
  renameSession(id: string, title: string): boolean;
  /** 阶段 13（PR #8）：会话级"全部自动批准"开关 */
  setAutoApprove(id: string, on: boolean): boolean;
  deleteSession(id: string): boolean;
  appendMessage(msg: ChatMessageDTO): void;
  listMessages(sessionId: string): ChatMessageDTO[];
}

interface SessionRow {
  id: string;
  project_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  auto_approve: number | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls_json: string | null;
  created_at: string;
}

export class SqliteChatSessionRepository implements IChatSessionRepository {
  constructor(private readonly db: Database) {}

  createSession(s: ChatSession): void {
    this.db.run(
      `INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at, auto_approve)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        s.projectId,
        s.title,
        s.createdAt.toISOString(),
        s.updatedAt.toISOString(),
        s.autoApprove ? 1 : 0,
      ],
    );
  }

  findSessionById(id: string): ChatSession | null {
    const row = this.db.queryRow<SessionRow>(
      `SELECT id, project_id, title, created_at, updated_at, auto_approve
       FROM chat_sessions WHERE id=?`,
      [id],
    );
    if (!row) return null;
    return this.rowToSession(row);
  }

  listSessionsByProject(projectId: ProjectId | null, limit = 50): ChatSessionDTO[] {
    let rows: SessionRow[];
    if (projectId === null) {
      rows = this.db.query<SessionRow>(
        `SELECT id, project_id, title, created_at, updated_at, auto_approve FROM chat_sessions
         WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT ?`,
        [limit],
      );
    } else {
      rows = this.db.query<SessionRow>(
        `SELECT id, project_id, title, created_at, updated_at, auto_approve FROM chat_sessions
         WHERE project_id=? ORDER BY updated_at DESC LIMIT ?`,
        [projectId, limit],
      );
    }
    return rows.map((r) => this.rowToSession(r).toDTO());
  }

  listAllSessions(limit = 50): ChatSessionDTO[] {
    const rows = this.db.query<SessionRow>(
      `SELECT id, project_id, title, created_at, updated_at, auto_approve FROM chat_sessions
       ORDER BY updated_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => this.rowToSession(r).toDTO());
  }

  renameSession(id: string, title: string): boolean {
    const trimmed = title.trim();
    if (trimmed.length === 0) return false;
    const r = this.db.run(
      `UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?`,
      [trimmed, new Date().toISOString(), id],
    );
    return r.changes > 0;
  }

  /** 阶段 13（PR #8）：写回 auto_approve 列。 */
  setAutoApprove(id: string, on: boolean): boolean {
    const r = this.db.run(
      `UPDATE chat_sessions SET auto_approve=?, updated_at=? WHERE id=?`,
      [on ? 1 : 0, new Date().toISOString(), id],
    );
    return r.changes > 0;
  }

  deleteSession(id: string): boolean {
    // ON DELETE CASCADE 自动清理 messages
    const r = this.db.run(`DELETE FROM chat_sessions WHERE id=?`, [id]);
    return r.changes > 0;
  }

  appendMessage(msg: ChatMessageDTO): void {
    // 校验 role
    if (!ChatMessageRoles.includes(msg.role)) {
      throw new Error(`invalid chat message role: ${msg.role}`);
    }
    this.db.withTransaction(() => {
      this.db.run(
        `INSERT INTO chat_messages (id, session_id, role, content, tool_calls_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          msg.id,
          msg.sessionId,
          msg.role,
          msg.content,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.createdAt.toISOString(),
        ],
      );
      // 同步 session.updated_at
      this.db.run(
        `UPDATE chat_sessions SET updated_at=? WHERE id=?`,
        [msg.createdAt.toISOString(), msg.sessionId],
      );
    });
  }

  listMessages(sessionId: string): ChatMessageDTO[] {
    const rows = this.db.query<MessageRow>(
      `SELECT id, session_id, role, content, tool_calls_json, created_at FROM chat_messages
       WHERE session_id=? ORDER BY created_at ASC`,
      [sessionId],
    );
    return rows.map((r) => this.rowToMessage(r));
  }

  private rowToSession(r: SessionRow): ChatSession {
    const s = new ChatSession(
      r.id,
      r.project_id as ProjectId | null,
      r.title,
      new Date(r.created_at),
      new Date(r.updated_at),
      (r.auto_approve ?? 0) === 1,
    );
    return s;
  }

  private rowToMessage(r: MessageRow): ChatMessageDTO {
    let toolCalls: ChatMessageDTO["toolCalls"];
    if (r.tool_calls_json) {
      try {
        toolCalls = JSON.parse(r.tool_calls_json);
      } catch {
        toolCalls = undefined;
      }
    }
    return {
      id: r.id,
      sessionId: r.session_id,
      role: ChatMessageRoles.includes(r.role as never) ? (r.role as never) : "system",
      content: r.content,
      ...(toolCalls !== undefined ? { toolCalls } : {}),
      createdAt: new Date(r.created_at),
    };
  }
}
