/**
 * 内置 Tool 注册表 —— 启动期装载
 *
 * 阶段 6.0g：read_module 是 class（需要注入 SnapshotRegistry / repos）
 * 阶段 7.4h：4 个 const 也转成 class（ListFilesTool / ReadFileTool / SearchKnowledgeTool /
 *           CurrentDatetimeTool），使其支持运行时 configure(opts)。
 *           注册时仍直接 register(class instance)；class 满足 Tool<TArgs,TR> 接口。
 */

import { ToolRegistry } from "./tool-registry.ts";
import { CurrentDatetimeTool } from "./builtin/current-datetime.tool.ts";
import { ListFilesTool } from "./builtin/list-files.tool.ts";
import { ReadFileTool } from "./builtin/read-file.tool.ts";
import { SearchKnowledgeTool, type SearchKnowledgeToolDeps } from "./builtin/search-knowledge.tool.ts";
import { ReadModuleTool, type ReadModuleToolDeps } from "./builtin/read-module.tool.ts";
import { buildWriteableTools, type WriteableToolsDeps } from "./builtin/writeable-tools.ts";
import type { Tool } from "./tool.ts";

export interface BuildBuiltinToolRegistryOptions {
  /** 注入 read_module 依赖；不传则不注册该工具 */
  readModule?: ReadModuleToolDeps;
  /** 注入 search_knowledge 依赖（H12 修复）；不传则用占位 fallback */
  searchKnowledge?: SearchKnowledgeToolDeps;
}

export function buildBuiltinToolRegistry(opts: BuildBuiltinToolRegistryOptions = {}): ToolRegistry {
  const r = new ToolRegistry();
  r.register(new CurrentDatetimeTool());
  r.register(new ListFilesTool());
  r.register(new ReadFileTool());
  r.register(new SearchKnowledgeTool(opts.searchKnowledge ?? {}));
  if (opts.readModule) {
    r.register(new ReadModuleTool(opts.readModule));
  }
  return r;
}

/**
 * 阶段 H：往一个已存在的 registry 上追加 7 个写工具
 * 拆出来便于 main.ts 单独 wire（写工具需要 service 依赖）。
 */
export function registerWriteableTools(
  registry: ToolRegistry,
  deps: WriteableToolsDeps,
): Tool[] {
  const tools = buildWriteableTools(deps);
  for (const t of tools) registry.register(t);
  return tools;
}

// 向后兼容的 const 引用（测试 / 旧调用方）
export { CurrentDatetimeTool } from "./builtin/current-datetime.tool.ts";
export { ListFilesTool } from "./builtin/list-files.tool.ts";
export { ReadFileTool } from "./builtin/read-file.tool.ts";
export { SearchKnowledgeTool } from "./builtin/search-knowledge.tool.ts";
export { ReadModuleTool } from "./builtin/read-module.tool.ts";