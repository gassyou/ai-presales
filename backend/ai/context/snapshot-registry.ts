/**
 * SnapshotRegistry —— 业务模块快照提供者注册表
 *
 * 概念：
 *   - 每个业务模块（如"现状分析"、"痛点"、"ROI"）实现一次 BusinessModuleSnapshotProvider
 *   - 启动期把所有 provider 注册到 SnapshotRegistry
 *   - ContextAssembler 调 scoreRelevance() 排序，挑 Top-K 装配到 LLM 上下文
 *
 * 阶段 6.0b：注册表 + 接口；具体 provider 在阶段 7+（业务模块）逐个实现。
 * 本阶段提供：
 *   - project-snapshot.provider  （降级路径，6.0d 实现）
 *   - rag.provider              （主路径，6.0d 实现）
 *   - mention-resolver          （@xxx 解析，6.0d 实现）
 */

import type { ProjectId } from "@shared/types/ids.ts";

/** 业务模块名（如 "现状分析"、"痛点"、"ROI"） */
export type ModuleName = string;

/** 给 LLM 看的项目摘要/上下文片段 */
export interface ContextFragment {
  readonly source: ModuleName | "project-snapshot" | "rag" | "mention" | "system";
  readonly projectId: ProjectId | null;
  readonly title: string;
  readonly content: string;
  /** 实际占用的 token（填装后回填，用于审计） */
  readonly tokensUsed?: number;
}

/**
 * 业务模块快照提供者接口
 *
 * 每个业务模块实现：
 *   - moduleName：模块名
 *   - scoreRelevance：评估本次输入与该模块的相关性（0..1）
 *   - summarize：取该模块下项目内容，截到 maxTokens 以内
 */
export interface BusinessModuleSnapshotProvider {
  readonly moduleName: ModuleName;
  scoreRelevance(input: { projectId: ProjectId; userInput: string }): Promise<number>;
  summarize(input: { projectId: ProjectId; maxTokens: number }): Promise<ContextFragment | null>;
}

/**
 * 项目级快照提供者 —— 降级路径（未入库项目走这里）
 *
 * 不是 BusinessModuleSnapshotProvider，因为它是"全局兜底"而不是"按相关性挑选"。
 */
export interface ProjectSnapshotProvider {
  /** 取项目的精简摘要（标题 / 状态 / 客户名 / 已填模块列表） */
  summarize(input: { projectId: ProjectId; maxTokens: number }): Promise<ContextFragment | null>;
  /** 模糊匹配 @xxx → ProjectId[]；找不到的 mention 降级为字面 */
  resolveMentions(
    rawTokens: readonly string[],
  ): Promise<{ matched: Array<{ token: string; projectId: ProjectId }>; unmatched: string[] }>;
}

/**
 * RAG 提供者 —— 主路径（已入库项目走这里）
 *
 * 检索 project 的已采纳知识 chunks；未入库项目无 chunks，返回空。
 */
export interface RagProvider {
  retrieve(input: { query: string; projectId: ProjectId; topK: number; minScore: number }): Promise<readonly ContextFragment[]>;
}

/**
 * 注册表 —— 进程内单例
 *
 * Provider 是不可变的，启动期 register；运行期只读。
 */
export class SnapshotRegistry {
  private readonly modules = new Map<ModuleName, BusinessModuleSnapshotProvider>();
  private projectProvider: ProjectSnapshotProvider | null = null;
  private ragProvider: RagProvider | null = null;

  registerModule(provider: BusinessModuleSnapshotProvider): void {
    if (this.modules.has(provider.moduleName)) {
      throw new Error(`snapshot provider already registered: ${provider.moduleName}`);
    }
    this.modules.set(provider.moduleName, provider);
  }

  registerProjectProvider(provider: ProjectSnapshotProvider): void {
    if (this.projectProvider) {
      throw new Error("project snapshot provider already registered");
    }
    this.projectProvider = provider;
  }

  registerRagProvider(provider: RagProvider): void {
    if (this.ragProvider) {
      throw new Error("rag provider already registered");
    }
    this.ragProvider = provider;
  }

  getProjectProvider(): ProjectSnapshotProvider | null {
    return this.projectProvider;
  }

  getRagProvider(): RagProvider | null {
    return this.ragProvider;
  }

  listModules(): readonly ModuleName[] {
    return [...this.modules.keys()];
  }

  /**
   * 评估并排序所有业务模块的相关性分数
   * 返回按分数降序的 [moduleName, score] 列表
   */
  async scoreAll(input: { projectId: ProjectId; userInput: string }): Promise<Array<{ module: ModuleName; score: number }>> {
    const out: Array<{ module: ModuleName; score: number }> = [];
    for (const [moduleName, provider] of this.modules) {
      const score = await provider.scoreRelevance(input);
      out.push({ module: moduleName, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  getModule(name: ModuleName): BusinessModuleSnapshotProvider | null {
    return this.modules.get(name) ?? null;
  }
}