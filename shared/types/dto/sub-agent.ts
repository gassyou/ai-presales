/**
 * Sub-Agent / Tool DTO
 *
 * 阶段 13（PR #3）：
 *   - SubAgentSpecDTO 加 type: "system" | "user" 字段
 *   - 新增 CreateUserSubAgentInput / UpdateUserSubAgentInput 用于 user 子 agent 的增改
 *   - 系统 sub-agent 不可走 create / update（前端 UI 不暴露，后端 createAgentSpec 内部强制 type=user）
 *   - 系统 sub-agent 不可删除（后端 deleteAgentSpec 校验）
 */

export interface ToolMetadataDTO {
  name: string;
  description: string;
  requiresApproval: boolean;
  sideEffect: "none" | "read" | "write" | "external";
}

export type SubAgentType = "system" | "user";

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
  /** 阶段 13（PR #3）：sub-agent 类型。system = 内置不可改；user = 用户可编辑/删除 */
  type: SubAgentType;
  /** 兼容：后端保留此字段为"软 alias"，前端 UI 按 type 渲染 */
  builtIn: boolean;
}

/**
 * 创建用户 sub-agent 的输入。name 由前端按正则 `^[a-z][a-z0-9_-]{2,63}$` 校验。
 * 后端 createAgentSpec 会强制 type=user（忽略调用方传入）。
 */
export interface CreateUserSubAgentInput {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  toolNames: string[];
  profileHint?: string;
}

/**
 * 编辑用户 sub-agent 的输入。name / type 由后端锁定（不可改）。
 * profileHint = null 表示清空；undefined 表示不修改。
 */
export interface UpdateUserSubAgentInput {
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  toolNames?: string[];
  profileHint?: string | null;
}
