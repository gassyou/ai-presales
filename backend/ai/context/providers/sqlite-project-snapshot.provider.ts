/**
 * SqliteProjectSnapshotProvider —— 真实实现（替换 6.0b 占位）
 *
 * summarize(input):
 *   - 拿项目元数据（code / name / clientName / status / createdAt）
 *   - 截到 maxTokens 以内（200 token 默认）
 *   - 输出 ContextFragment{ source: 'project-snapshot', projectId, title, content }
 *
 * resolveMentions(rawTokens):
 *   - 用 IProjectRepository.findByMentionToken(token) 模糊匹配
 *   - 匹配到的进 matched[]；找不到的进 unmatched[]（ContextAssembler 把它们当字面字符串渲染）
 */

import type { ProjectId } from "@shared/types/ids.ts";
import { type IProjectRepository } from "@backend/domain/project/project.repository.ts";
import type { IKnowledgeChunkRepository } from "@backend/domain/knowledge/knowledge-chunk.repository.ts";
import { truncateToTokens } from "../context-budget.ts";
import type { TokenCounter } from "../token-counter.ts";
import type { ContextFragment, ProjectSnapshotProvider } from "../snapshot-registry.ts";

export interface ProjectSnapshotProviderDeps {
  projectRepo: IProjectRepository;
  chunkRepo: IKnowledgeChunkRepository;
  tokenCounter: TokenCounter;
  /** 阶段 7.4e：可选联系人/团队仓储；不传则略过"收件人候选"段 */
  contactsRepo?: import("@backend/domain/project/project-contacts.repository.ts").IProjectContactsRepository;
  teamRepo?: import("@backend/domain/project/project-team-members.repository.ts").IProjectTeamMembersRepository;
}

export class SqliteProjectSnapshotProvider implements ProjectSnapshotProvider {
  constructor(private readonly deps: ProjectSnapshotProviderDeps) {}

  async summarize(input: { projectId: ProjectId; maxTokens: number }): Promise<ContextFragment | null> {
    const { projectRepo, chunkRepo, tokenCounter } = this.deps;
    const snap = await projectRepo.findSnapshotById(input.projectId);
    if (!snap) return null;

    const chunkCount = await chunkRepo.countByProject(input.projectId);
    const indexedTag = chunkCount > 0 ? "已入库知识库" : "未入库知识库";

    const lines: string[] = [
      `- 项目编号：${snap.code}`,
      `- 项目名称：${snap.name}`,
      `- 客户名称：${snap.clientName}`,
      `- 当前状态：${snap.status}`,
      `- 创建时间：${snap.createdAt.toISOString().slice(0, 10)}`,
      `- 更新时间：${snap.updatedAt.toISOString().slice(0, 10)}`,
      `- 知识库：${indexedTag}（${chunkCount} 块）`,
    ];
    // 阶段 7.4e：收件人候选（仅在 maxTokens 足够时追加，截断自动剥尾）
    const recipientBlock = await this.buildRecipientBlock(input.projectId, 150);
    if (recipientBlock) lines.push("", recipientBlock);
    const raw = `## 项目摘要 (${snap.code} ${snap.name})\n${lines.join("\n")}`;
    const content = truncateToTokens(raw, input.maxTokens, tokenCounter);

    return {
      source: "project-snapshot",
      projectId: input.projectId,
      title: `项目 ${snap.code}`,
      content,
      tokensUsed: tokenCounter.count(content),
    };
  }

  async resolveMentions(
    rawTokens: readonly string[],
  ): Promise<{ matched: Array<{ token: string; projectId: ProjectId }>; unmatched: string[] }> {
    const matched: Array<{ token: string; projectId: ProjectId }> = [];
    const unmatched: string[] = [];
    for (const token of rawTokens) {
      const snap = await this.deps.projectRepo.findByMentionToken(token);
      if (snap) {
        matched.push({ token, projectId: snap.id });
      } else {
        unmatched.push(token);
      }
    }
    return { matched, unmatched };
  }

  private async buildRecipientBlock(projectId: ProjectId, maxTokens: number): Promise<string | null> {
    if (!this.deps.contactsRepo && !this.deps.teamRepo) return null;
    const [contacts, team] = await Promise.all([
      this.deps.contactsRepo ? this.deps.contactsRepo.listByProject(projectId) : Promise.resolve([]),
      this.deps.teamRepo ? this.deps.teamRepo.listByProject(projectId) : Promise.resolve([]),
    ]);
    if (contacts.length === 0 && team.length === 0) return null;
    const lines: string[] = ["- 收件人候选（联系人 / 主联系人标 *）："];
    for (const c of contacts) {
      const star = c.isPrimary ? "*" : " ";
      const title = c.title ? `（${c.title}）` : "";
      lines.push(`  ${star} ${c.name}${title} <${c.email || "无邮箱"}>`);
    }
    if (team.length > 0) lines.push("- 抄送候选（团队成员）：");
    for (const m of team) {
      lines.push(`    ${m.name} <${m.email || "无邮箱"}>`);
    }
    return truncateToTokens(lines.join("\n"), maxTokens, this.deps.tokenCounter);
  }
}