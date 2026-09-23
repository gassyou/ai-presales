/**
 * list_files —— 列出 cwd 或子目录下的文件
 *
 * sideEffect = "read"；受 allowedPaths 约束（运行时由 executor 决定，本工具不重复校验）。
 *
 * 注意：本工具**只**拼接 ctx.cwd 与入参 path；防止 path traversal 由 executor 在 cwd 校验中兜底。
 *
 * 阶段 7.4h：const → class 以支持运行时配置（defaultMax / defaultRecursive）。
 */

import type { Tool } from "../tool.ts";
import { fail, ok } from "../tool.ts";
import { join, normalize } from "@std/path";

export interface ListFilesArgs {
  /** 相对路径（相对 ctx.cwd）；缺省为 cwd */
  readonly path?: string;
  /** 是否包含子目录 */
  readonly recursive?: boolean;
  /** 最多返回条数（防爆） */
  readonly max?: number;
}

export interface ListFilesResult {
  readonly path: string;
  readonly entries: Array<{
    readonly name: string;
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly size?: number;
  }>;
}

const DEFAULT_MAX = 100;

export class ListFilesTool implements Tool<ListFilesArgs, ListFilesResult> {
  readonly name = "list_files";
  readonly description = "列出指定目录下的文件和文件夹。默认 cwd，可指定子目录。";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      path: { type: "string", description: "相对 cwd 的子目录路径；缺省为 cwd" },
      recursive: { type: "boolean", default: false },
      max: { type: "integer", minimum: 1, maximum: 500, default: DEFAULT_MAX },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = false;
  readonly sideEffect: "read" = "read";

  private defaultMax = DEFAULT_MAX;
  private defaultRecursive = false;

  configure(opts: Record<string, unknown>): void {
    if (typeof opts.defaultMax === "number" && opts.defaultMax >= 1) {
      this.defaultMax = Math.floor(opts.defaultMax);
    }
    if (typeof opts.defaultRecursive === "boolean") {
      this.defaultRecursive = opts.defaultRecursive;
    }
  }

  async execute(args: ListFilesArgs, ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<ListFilesResult>> {
    const rel = (args?.path ?? "").trim();
    const target = rel.length === 0 ? ctx.cwd : join(ctx.cwd, normalize(rel));
    const recursive = (args && (args as ListFilesArgs).recursive === true) || this.defaultRecursive;
    const max = (args && (args as ListFilesArgs).max) ?? this.defaultMax;

    let entries: Array<{ name: string; isFile: boolean; isDirectory: boolean; size?: number }>;
    try {
      const collected: Array<{ name: string; isFile: boolean; isDirectory: boolean; size?: number }> = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for await (const e of Deno.readDir(dir)) {
          if (collected.length >= max) return;
          const fullPath = join(dir, e.name);
          const entry: { name: string; isFile: boolean; isDirectory: boolean; size?: number } = {
            name: prefix ? `${prefix}/${e.name}` : e.name,
            isFile: e.isFile,
            isDirectory: e.isDirectory,
          };
          if (e.isFile) {
            try {
              const stat = await Deno.stat(fullPath);
              entry.size = stat.size;
            } catch {/* size optional */}
          }
          collected.push(entry);
          if (recursive && e.isDirectory && collected.length < max) {
            await walk(fullPath, entry.name);
          }
        }
      };
      await walk(target, "");
      entries = collected;
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    return ok({ path: target, entries });
  }
}

/** 向后兼容的 const 引用（测试 / 旧调用方） */
export const listFilesTool: Tool<ListFilesArgs, ListFilesResult> = new ListFilesTool();