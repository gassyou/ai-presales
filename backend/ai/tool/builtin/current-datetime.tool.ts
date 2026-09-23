/**
 * current_datetime —— 返回当前 ISO 时间
 *
 * 纯函数；sideEffect = "none"。
 *
 * 阶段 7.4h：const → class 以支持运行时配置。
 */

import type { Tool } from "../tool.ts";
import { ok } from "../tool.ts";

export interface CurrentDatetimeArgs {
  readonly timezone?: string;
}

export interface CurrentDatetimeResult {
  readonly iso: string;
  readonly timezone: string;
}

export class CurrentDatetimeTool implements Tool<CurrentDatetimeArgs, CurrentDatetimeResult> {
  readonly name = "current_datetime";
  readonly description =
    "返回当前时间（ISO-8601 字符串），用于在 prompt 里注入时间上下文。";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA 时区名，如 Asia/Tokyo。缺省 UTC。",
      },
    },
    additionalProperties: false,
  };
  readonly requiresApproval = false;
  readonly sideEffect: "none" = "none";

  private defaultTimezone = "UTC";

  configure(opts: Record<string, unknown>): void {
    if (typeof opts.timezone === "string" && opts.timezone.length > 0) {
      this.defaultTimezone = opts.timezone;
    }
  }

  async execute(args: CurrentDatetimeArgs): Promise<import("../tool.ts").ToolResult<CurrentDatetimeResult>> {
    const tz = args?.timezone ?? this.defaultTimezone;
    let iso: string;
    try {
      iso = new Date().toLocaleString("en-US", { timeZone: tz, hour12: false });
    } catch {
      iso = new Date().toISOString();
    }
    return ok({ iso, timezone: tz });
  }
}

/** 向后兼容的 const 引用（测试 / 旧调用方） */
export const currentDatetimeTool: Tool<CurrentDatetimeArgs, CurrentDatetimeResult> = new CurrentDatetimeTool();