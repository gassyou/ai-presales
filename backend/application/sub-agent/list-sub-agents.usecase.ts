/**
 * ListSubAgentsUseCase —— 列出全部 sub-agent specs
 */

import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";

export interface SubAgentListItem {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly toolNames: readonly string[];
  readonly profileHint?: string;
}

export class ListSubAgentsUseCase {
  constructor(private readonly registry: ISubAgentRegistry) {}

  execute(): readonly SubAgentListItem[] {
    return this.registry.list().map((spec) => ({
      name: spec.name,
      displayName: spec.displayName,
      description: spec.description,
      toolNames: spec.toolNames,
      ...(spec.profileHint !== undefined ? { profileHint: spec.profileHint } : {}),
    }));
  }
}