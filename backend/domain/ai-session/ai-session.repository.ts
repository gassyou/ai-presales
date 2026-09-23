/**
 * IAiSessionRepository —— 会话仓储接口
 *
 * 设计：
 *   - save(session) 一个事务写 sessions + messages
 *   - findById 重建聚合根 + 全部 messages（rehydrate）
 *   - findByIdWithMessages 与 findById 等价
 *   - listByProject 按 projectId 列出会话（不含 messages，省 IO）
 *   - listActive 给后台扫描 job 用
 */

import type { AiSessionId, ProjectId } from "@shared/types/ids.ts";
import type { DomainResult } from "../shared/result.ts";
import { AiSession, type AiSessionSnapshot, type AiSessionStatus } from "./ai-session.ts";

export interface AiSessionListFilter {
  projectId?: ProjectId;
  status?: AiSessionStatus;
  limit: number;
  offset: number;
}

export interface AiSessionListResult {
  items: readonly AiSessionSnapshot[];
  total: number;
  limit: number;
  offset: number;
}

export interface IAiSessionRepository {
  save(session: AiSession): Promise<DomainResult<void>>;
  findById(id: AiSessionId): Promise<DomainResult<AiSession>>;
  findSnapshotById(id: AiSessionId): Promise<AiSessionSnapshot | null>;
  list(filter: AiSessionListFilter): Promise<AiSessionListResult>;
  /** 取最近引用计分 ≥ threshold 的助手消息，给后台采纳 job 用 */
  findFrequentlyCitedMessages(
    threshold: number,
    limit: number,
  ): Promise<readonly { sessionId: AiSessionId; messageId: string; cites: number }[]>;
  /** 物理删除 expire_at < now 的会话 */
  purgeExpired(now: Date): Promise<number>;
  /**
   * 阶段 6.0g：拉某项目下全部非空消息（按 session_id 分组），给 ingest 用。
   * 不走 rehydrate（不需要聚合根），按时间顺序返回纯消息数组。
   */
  listMessagesByProject(
    projectId: ProjectId,
    limit: number,
  ): Promise<readonly {
    readonly messageId: string;
    readonly sessionId: string;
    readonly role: "user" | "assistant" | "system" | "tool";
    readonly content: string;
    readonly createdAt: Date;
  }[]>;
}