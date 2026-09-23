/**
 * ToolRegistry —— 进程内工具注册表
 *
 * name 唯一；register 重复名字抛错。
 */

import type { Tool } from "./tool.ts";

export interface IToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  has(name: string): boolean;
  list(): readonly Tool[];
  names(): readonly string[];
}

export class ToolRegistry implements IToolRegistry {
  private readonly _tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this._tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this._tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  list(): readonly Tool[] {
    return Array.from(this._tools.values());
  }

  names(): readonly string[] {
    return Array.from(this._tools.keys());
  }

  /** 仅测试使用 */
  clear(): void {
    this._tools.clear();
  }

  /** 把注册表内的工具转成 LLM `tools` 参数（OpenAI / Anthropic mapper 都吃这个） */
  toLLMTools(): Array<{
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
  }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}