/**
 * SqliteAiSessionRepository —— ai_sessions + ai_messages + ai_message_cites 仓储
 *
 * 设计：
 *   - save(session) 一个事务写 sessions + 全部 messages + 引用计分（upsert）
 *   - findById 一次性查 session + 全部 messages + cites map
 *   - findSnapshotById 只查 sessions 表（无 messages）
 *   - list 不返回 messages（省 IO）；上层按需 findById 拿详情
 *   - 引用计分持久化在 ai_message_cites；appendMessage 时已 +1 in-memory，
 *     这里直接 UPSERT 即可
 *
 * 注意：
 *   - toolCalls / sourceProjectIds / citedMessageIds 用 JSON 列；读写都 parse/stringify
 *   - JSON 解析失败应 fail-fast —— 属于 corrupt 数据
 */

import { AiSessionId } from "@shared/types/ids.ts";
import type { AiSessionId as AiSessionIdT, ProjectId } from "@shared/types/ids.ts";
import { AiSessionId as toAiSessionId } from "@shared/types/ids.ts";
import type { Database, QueryParam } from "../database/database.ts";
import type {
  AiSessionListFilter,
  AiSessionListResult,
  IAiSessionRepository,
} from "@backend/domain/ai-session/ai-session.repository.ts";
import { type DomainResult, domainErr, domainOk } from "@backend/domain/shared/result.ts";
import { AiSession, type AiSessionSnapshot, type AiSessionStatus } from "@backend/domain/ai-session/ai-session.ts";
import {
  AiMessage,
  type MessageSnapshot,
  type MessageToolCallSnapshot,
} from "@backend/domain/ai-session/message.ts";
import type { MessageId as MessageIdT, ToolCallId as ToolCallIdT } from "@shared/types/ids.ts";
import { MessageId as toMessageId, ToolCallId as toToolCallId } from "@shared/types/ids.ts";

interface SessionRow {
  id: string;
  project_id: string | null;
  sub_agent_name: string | null;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  expire_at: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls_json: string;
  source_project_ids_json: string;
  cited_message_ids_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface CiteRow {
  message_id: string;
  cite_count: number;
}

function rowToSessionSnapshot(row: SessionRow): AiSessionSnapshot {
  return {
    id: toAiSessionId(row.id),
    projectId: row.project_id ? (row.project_id as unknown as ProjectId) : null,
    subAgentName: row.sub_agent_name,
    title: row.title,
    status: row.status as AiSessionStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expireAt: row.expire_at ? new Date(row.expire_at) : null,
    messageCount: 0,  // list 路径不统计；如需要可通过额外 query 补
  };
}

function parseToolCalls(json: string): readonly MessageToolCallSnapshot[] {
  if (!json || json === "[]") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`corrupt tool_calls_json: ${json.slice(0, 100)}`);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((raw, i) => {
    const t = raw as Record<string, unknown>;
    return {
      id: toToolCallId(typeof t.id === "string" ? t.id : `corrupt-${i}`),
      name: typeof t.name === "string" ? t.name : "",
      args: t.args,
      result: t.result,
      ok: t.ok === true,
      durationMs: typeof t.durationMs === "number" ? t.durationMs : 0,
      ...(typeof t.error === "string" ? { error: t.error } : {}),
    };
  });
}

function parseStringIds(json: string): readonly string[] {
  if (!json || json === "[]") return [];
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is string => typeof x === "string");
}

function rowToMessageSnapshot(row: MessageRow): MessageSnapshot {
  return {
    id: toMessageId(row.id),
    sessionId: row.session_id,
    role: row.role as MessageSnapshot["role"],
    content: row.content,
    toolCalls: parseToolCalls(row.tool_calls_json),
    sourceProjectIds: parseStringIds(row.source_project_ids_json) as unknown as ProjectId[],
    citedMessageIds: parseStringIds(row.cited_message_ids_json) as unknown as MessageIdT[],
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: new Date(row.created_at),
  };
}

export class SqliteAiSessionRepository implements IAiSessionRepository {
  constructor(private readonly db: Database) {}

  async save(session: AiSession): Promise<DomainResult<void>> {
    const snap = session.snapshot();
    const messages = session.messageSnapshots();
    const cites = session.citedCountMap();
    try {
      this.db.withTransaction(() => {
        this.db.run(
          `INSERT INTO ai_sessions (id, project_id, sub_agent_name, title, status, created_at, updated_at, expire_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id,
             sub_agent_name = excluded.sub_agent_name,
             title = excluded.title,
             status = excluded.status,
             updated_at = excluded.updated_at,
             expire_at = excluded.expire_at`,
          [
            snap.id,
            snap.projectId,
            snap.subAgentName,
            snap.title,
            snap.status,
            snap.createdAt.toISOString(),
            snap.updatedAt.toISOString(),
            snap.expireAt ? snap.expireAt.toISOString() : null,
          ] as QueryParam[],
        );

        // 删旧 messages 重写（聚合根一个事务，简化策略；后续优化用 diff）
        this.db.run("DELETE FROM ai_messages WHERE session_id = ?", [snap.id]);

        for (const m of messages) {
          this.db.run(
            `INSERT INTO ai_messages (id, session_id, role, content, tool_calls_json, source_project_ids_json, cited_message_ids_json, input_tokens, output_tokens, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              m.id,
              m.sessionId,
              m.role,
              m.content,
              JSON.stringify(m.toolCalls),
              JSON.stringify(m.sourceProjectIds),
              JSON.stringify(m.citedMessageIds),
              m.inputTokens,
              m.outputTokens,
              m.createdAt.toISOString(),
            ] as QueryParam[],
          );
        }

        // 引用计分 upsert
        const nowIso = new Date().toISOString();
        for (const [msgId, count] of cites) {
          this.db.run(
            `INSERT INTO ai_message_cites (session_id, message_id, cite_count, last_cited_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(message_id) DO UPDATE SET
               cite_count = excluded.cite_count,
               last_cited_at = excluded.last_cited_at`,
            [snap.id, msgId, count, nowIso] as QueryParam[],
          );
        }

        // 丢掉 pending events —— 调用方 dispatch
        session.pullDomainEvents();
      });
      return domainOk(undefined);
    } catch (e) {
      return domainErr("INTERNAL", `save ai-session failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async findById(id: AiSessionIdT): Promise<DomainResult<AiSession>> {
    const row = this.db.queryRow<SessionRow>(
      "SELECT id, project_id, sub_agent_name, title, status, created_at, updated_at, expire_at FROM ai_sessions WHERE id = ?",
      [id],
    );
    if (!row) return domainErr("NOT_FOUND", `ai-session ${id} not found`);
    const msgRows = this.db.query<MessageRow>(
      "SELECT id, session_id, role, content, tool_calls_json, source_project_ids_json, cited_message_ids_json, input_tokens, output_tokens, created_at FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC",
      [id],
    );
    const citeRows = this.db.query<CiteRow>(
      "SELECT message_id, cite_count FROM ai_message_cites WHERE session_id = ?",
      [id],
    );
    const citedCount = new Map<string, number>();
    for (const c of citeRows) citedCount.set(c.message_id, c.cite_count);
    const messages = msgRows.map(rowToMessageSnapshot);
    try {
      const session = AiSession.rehydrate({
        id: toAiSessionId(row.id),
        projectId: row.project_id ? (row.project_id as unknown as ProjectId) : null,
        subAgentName: row.sub_agent_name,
        title: row.title,
        status: row.status as AiSessionStatus,
        messages,
        citedCount,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        expireAt: row.expire_at ? new Date(row.expire_at) : null,
      });
      return domainOk(session);
    } catch (e) {
      return domainErr("INTERNAL", `rehydrate ai-session failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async findSnapshotById(id: AiSessionIdT): Promise<AiSessionSnapshot | null> {
    const row = this.db.queryRow<SessionRow>(
      "SELECT id, project_id, sub_agent_name, title, status, created_at, updated_at, expire_at FROM ai_sessions WHERE id = ?",
      [id],
    );
    if (!row) return null;
    const cnt = this.db.queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM ai_messages WHERE session_id = ?",
      [id],
    );
    const snap = rowToSessionSnapshot(row);
    return { ...snap, messageCount: cnt?.c ?? 0 };
  }

  async list(filter: AiSessionListFilter): Promise<AiSessionListResult> {
    const where: string[] = [];
    const params: QueryParam[] = [];
    if (filter.projectId) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const totalRow = this.db.queryRow<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ai_sessions ${whereClause}`,
      params,
    );
    const total = totalRow?.c ?? 0;

    const rows = this.db.query<SessionRow>(
      `SELECT id, project_id, sub_agent_name, title, status, created_at, updated_at, expire_at
       FROM ai_sessions ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    return {
      items: rows.map((r) => ({ ...rowToSessionSnapshot(r), messageCount: 0 })),
      total,
      limit: filter.limit,
      offset: filter.offset,
    };
  }

  async findFrequentlyCitedMessages(
    threshold: number,
    limit: number,
  ): Promise<readonly { sessionId: AiSessionIdT; messageId: string; cites: number }[]> {
    const rows = this.db.query<{ session_id: string; message_id: string; cite_count: number }>(
      `SELECT session_id, message_id, cite_count
       FROM ai_message_cites
       WHERE cite_count >= ?
       ORDER BY cite_count DESC, last_cited_at DESC
       LIMIT ?`,
      [threshold, limit],
    );
    return rows.map((r) => ({
      sessionId: toAiSessionId(r.session_id),
      messageId: r.message_id,
      cites: r.cite_count,
    }));
  }

  async purgeExpired(now: Date): Promise<number> {
    const r = this.db.run(
      "DELETE FROM ai_sessions WHERE expire_at IS NOT NULL AND expire_at < ? AND status = 'active'",
      [now.toISOString()],
    );
    return r.changes;
  }

  async listMessagesByProject(
    projectId: ProjectId,
    limit: number,
  ): Promise<readonly {
    readonly messageId: string;
    readonly sessionId: string;
    readonly role: "user" | "assistant" | "system" | "tool";
    readonly content: string;
    readonly createdAt: Date;
  }[]> {
    // 只取有正文的 message（content 不为空、role 是 user/assistant 之一）
    const rows = this.db.query<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      created_at: string;
    }>(
      `SELECT m.id, m.session_id, m.role, m.content, m.created_at
       FROM ai_messages m
       JOIN ai_sessions s ON s.id = m.session_id
       WHERE s.project_id = ?
         AND m.role IN ('user', 'assistant')
         AND length(m.content) > 0
       ORDER BY m.created_at ASC
       LIMIT ?`,
      [projectId, limit],
    );
    return rows.map((r) => ({
      messageId: r.id,
      sessionId: r.session_id,
      role: r.role as "user" | "assistant" | "system" | "tool",
      content: r.content,
      createdAt: new Date(r.created_at),
    }));
  }
}