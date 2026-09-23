/**
 * Sub-Agent / Tool DTO
 */

export interface ToolMetadataDTO {
  name: string;
  description: string;
  requiresApproval: boolean;
  sideEffect: "none" | "read" | "write" | "external";
}

export interface SubAgentSpecDTO {
  name: string;
  description: string;
  systemPrompt: string;
  tools: readonly string[];
  modelHint: {
    profile: string;
    overrideTemperature?: number;
    overrideMaxTokens?: number;
  };
  /** 内置 agent 不可删除；用户自定义 agent 可编辑 */
  builtIn: boolean;
}