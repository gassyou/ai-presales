/**
 * read_file —— 读取文本文件
 *
 * sideEffect = "read"；受 allowedPaths 约束（运行时由 executor 决定）。
 *
 * 安全：拒绝路径含 `..`；只读常规文本（≤2MB）。
 *
 * 阶段 7.4h：const → class 以支持运行时配置（defaultMaxBytes / hardMaxBytes）。
 */

import type { Tool } from "../tool.ts";
import { fail, ok } from "../tool.ts";
import { join, normalize } from "@std/path";

export interface ReadFileArgs {
  /** 相对 cwd 的文件路径 */
  readonly path: string;
  /** 最大字节数（默认 256KB） */
  readonly maxBytes?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly size: number;
  readonly truncated: boolean;
}

const DEFAULT_MAX = 256 * 1024;
const HARD_MAX = 2 * 1024 * 1024;

export class ReadFileTool implements Tool<ReadFileArgs, ReadFileResult> {
  readonly name = "read_file";
  readonly description = "读取 cwd 内文本文件的内容（UTF-8）。";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", description: "相对 cwd 的文件路径" },
      maxBytes: { type: "integer", minimum: 1, maximum: 2097152, default: 262144 },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = false;
  readonly sideEffect: "read" = "read";

  private defaultMax = DEFAULT_MAX;
  private hardMax = HARD_MAX;

  configure(opts: Record<string, unknown>): void {
    if (typeof opts.defaultMaxBytes === "number" && opts.defaultMaxBytes >= 1) {
      this.defaultMax = Math.floor(opts.defaultMaxBytes);
    }
    if (typeof opts.hardMaxBytes === "number" && opts.hardMaxBytes >= 1) {
      this.hardMax = Math.floor(opts.hardMaxBytes);
    }
  }

  async execute(args: ReadFileArgs, ctx: import("../tool.ts").ToolContext): Promise<import("../tool.ts").ToolResult<ReadFileResult>> {
    const p = args?.path;
    if (typeof p !== "string" || p.length === 0) {
      return fail("path is required");
    }
    const norm = normalize(p);
    if (norm.startsWith("..") || norm.includes("/../") || norm.includes("\\..")) {
      return fail("path traversal not allowed");
    }
    const fullPath = join(ctx.cwd, norm);
    const max = Math.min(args?.maxBytes ?? this.defaultMax, this.hardMax);

    try {
      const file = await Deno.open(fullPath, { read: true });
      try {
        const stat = await file.stat();
        if (stat.size > max) {
          // 只读 max 字节，标注截断
          const buf = new Uint8Array(max);
          await file.read(buf);
          const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
          return ok({ path: fullPath, content: text, size: stat.size, truncated: true });
        }
        const text = await Deno.readTextFile(fullPath);
        return ok({ path: fullPath, content: text, size: stat.size, truncated: false });
      } finally {
        file.close();
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}

/** 向后兼容的 const 引用（测试 / 旧调用方） */
export const readFileTool: Tool<ReadFileArgs, ReadFileResult> = new ReadFileTool();