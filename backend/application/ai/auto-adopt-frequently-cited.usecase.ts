/**
 * AutoAdoptFrequentlyCitedUseCase —— 自动采纳被引用 ≥3 次的助手消息
 *
 * 流程：
 *   1. 扫 ai_message_cites 找 cite_count >= threshold 的助手消息
 *   2. 跳过已经被采纳过的（findBySourceMessage 命中）
 *   3. 拿原 assistant 消息内容 + 所在 session 的 projectId
 *   4. 调 AdoptToKnowledgeUseCase，adoptionKind='auto_high_cited'
 *
 * 设计：
 *   - threshold 默认 3（可由配置覆盖）
 *   - limit 默认 50（防止一次性采纳太多阻塞）
 *   - 失败一条不影响其他
 *   - 用于后台 cron / 定期 job
 */

import type { AiSessionId, MessageId } from "@shared/types/ids.ts";
import type { Clock } from "@backend/domain/shared/domain-event.ts";
import type { IAiSessionRepository } from "@backend/domain/ai-session/ai-session.repository.ts";
import { AdoptToKnowledgeUseCase } from "@backend/application/knowledge/adopt-to-knowledge.usecase.ts";
import type { IKnowledgeRepository } from "@backend/domain/knowledge/knowledge.repository.ts";
import { MessageId as toMessageId, AiSessionId as toAiSessionId } from "@shared/types/ids.ts";

export interface AutoAdoptArgs {
  threshold?: number;
  limit?: number;
}

export interface AutoAdoptResult {
  scanned: number;
  adopted: number;
  skipped: number;
  errors: Array<{ messageId: string; reason: string }>;
}

export interface AutoAdoptDeps {
  sessionRepo: IAiSessionRepository;
  knowledgeRepo: IKnowledgeRepository;
  adopt: AdoptToKnowledgeUseCase;
  clock: Clock;
}

export class AutoAdoptFrequentlyCitedUseCase {
  constructor(private readonly deps: AutoAdoptDeps) {}

  async execute(args: AutoAdoptArgs = {}): Promise<AutoAdoptResult> {
    const threshold = args.threshold ?? 3;
    const limit = args.limit ?? 50;

    const candidates = await this.deps.sessionRepo.findFrequentlyCitedMessages(threshold, limit);
    const result: AutoAdoptResult = { scanned: candidates.length, adopted: 0, skipped: 0, errors: [] };

    for (const cand of candidates) {
      try {
        // 拿原 message
        const sessionR = await this.deps.sessionRepo.findById(cand.sessionId);
        if (!sessionR.ok) {
          result.skipped++;
          continue;
        }
        const session = sessionR.value;
        const msg = session.messages.find((m) => m.id === cand.messageId);
        if (!msg) {
          result.skipped++;
          continue;
        }
        if (msg.role !== "assistant") {
          result.skipped++;
          continue;
        }
        if (!session.projectId) {
          result.skipped++;
          continue;
        }
        // dedupe 检查
        const existing = await this.deps.knowledgeRepo.findBySourceMessage(cand.messageId);
        if (existing) {
          result.skipped++;
          continue;
        }
        // 采纳
        const adoptR = await this.deps.adopt.execute({
          projectId: session.projectId,
          sourceMessageId: toMessageId(cand.messageId),
          sourceSessionId: toAiSessionId(cand.sessionId),
          title: msg.content.slice(0, 50) || "auto-adopted",
          body: msg.content,
          clock: this.deps.clock,
        });
        if (adoptR.ok) result.adopted++;
        else {
          result.errors.push({ messageId: cand.messageId, reason: adoptR.error.message });
        }
      } catch (e) {
        result.errors.push({
          messageId: cand.messageId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return result;
  }
}

// re-export 给测试用
export type { AiSessionId, MessageId };
