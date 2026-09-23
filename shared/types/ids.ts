/**
 * Branded ID 类型 —— 编译期防止 ID 混用
 */

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type ProjectId = Brand<string, "ProjectId">;
export type AiSessionId = Brand<string, "AiSessionId">;
export type MessageId = Brand<string, "MessageId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type KnowledgeItemId = Brand<string, "KnowledgeItemId">;
export type SubAgentId = Brand<string, "SubAgentId">;

export const ProjectId = (raw: string): ProjectId => raw as ProjectId;
export const AiSessionId = (raw: string): AiSessionId => raw as AiSessionId;
export const MessageId = (raw: string): MessageId => raw as MessageId;
export const ToolCallId = (raw: string): ToolCallId => raw as ToolCallId;
export const KnowledgeItemId = (raw: string): KnowledgeItemId => raw as KnowledgeItemId;
export const SubAgentId = (raw: string): SubAgentId => raw as SubAgentId;

/**
 * 生成 UUID v4（新 ID）
 */
export function newId<T extends string>(): T {
  return crypto.randomUUID() as T;
}