/**
 * SlashCommand —— 阶段 8（任务 8）：AI chat 输入解析器
 *
 * 支持的命令（阶段 8）：
 *   /help                列出可用 skill + 命令
 *   /skill <name> [args] 手动调用某个 skill，结果作为 user 文本发回 chat
 *   /attach <url>        标记附件（暂存为消息 meta 字段；UI 后续读取）
 *   其他                 透传为普通 user message（prefix = null）
 *
 * 设计：纯函数，无副作用，便于单元测试。
 */

export interface ParsedSlashCommand {
  readonly type: "help" | "skill" | "attach" | "passthrough";
  /** 主参数：skill 名 / attach url / passthrough 整行 */
  readonly arg: string;
  /** 附加参数（skill 接受的 args JSON 字符串，可选） */
  readonly extra?: string;
  /** 当 type=passthrough：去掉前导 "/" 后的原文；其他类型 null */
  readonly passthrough: string | null;
}

export interface ChatMessageAttachment {
  /** 附件 URL（前端可渲染为下载链接 / 图片缩略图） */
  readonly url: string;
  /** 解析时戳（ISO） */
  readonly addedAt: string;
}

/**
 * 解析单条 user 消息。返回结构化结果 + 可选的 attachment 列表。
 *
 * 注意：
 *   - 不带 "/" 前缀的输入 → passthrough
 *   - 解析失败的 /命令（如 /skill 缺名字）→ passthrough + arg="<原文本>"
 *     让上层用普通 LLM 兜底
 */
export function parseSlashCommand(
  text: string,
  now: () => Date = () => new Date(),
): {
  command: ParsedSlashCommand;
  attachments: ChatMessageAttachment[];
} {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return {
      command: {
        type: "passthrough",
        arg: trimmed,
        passthrough: trimmed,
      },
      attachments: [],
    };
  }
  // 切 tokens：/cmd arg0 [extra]
  const tokens = trimmed.split(/\s+/);
  const head = tokens[0]; // "/cmd"
  const cmd = head.slice(1).toLowerCase();
  const rest = tokens.slice(1);

  switch (cmd) {
    case "help": {
      return {
        command: { type: "help", arg: "", passthrough: null },
        attachments: [],
      };
    }
    case "skill": {
      const name = rest[0] ?? "";
      if (!name) {
        // 缺名字：passthrough 让 LLM 兜底
        return {
          command: { type: "passthrough", arg: trimmed, passthrough: trimmed },
          attachments: [],
        };
      }
      const extra = rest.slice(1).join(" ");
      return {
        command: {
          type: "skill",
          arg: name,
          ...(extra.length > 0 ? { extra } : {}),
          passthrough: null,
        },
        attachments: [],
      };
    }
    case "attach": {
      const url = rest[0] ?? "";
      if (!url) {
        return {
          command: { type: "passthrough", arg: trimmed, passthrough: trimmed },
          attachments: [],
        };
      }
      return {
        command: { type: "attach", arg: url, passthrough: null },
        attachments: [{ url, addedAt: now().toISOString() }],
      };
    }
    default:
      return {
        command: { type: "passthrough", arg: trimmed, passthrough: trimmed },
        attachments: [],
      };
  }
}

/**
 * 把 slash 解析结果合并到 chat 消息：passthrough 直接当 user 文本，
 * skill 命令 → 把 skill 返回拼成 "用户运行 /skill <name>：<result>" 注入 messages，
 * attach → 在 messages 上挂 attachments（ChatMessage DTO）。
 */
export function slashToMessageInjection(
  parsed: ParsedSlashCommand,
): { role: "user" | "system"; content: string } | null {
  switch (parsed.type) {
    case "passthrough":
      return { role: "user", content: parsed.arg };
    case "help":
      return {
        role: "system",
        content: "[slash 帮助] /help /skill <name> /attach <url>",
      };
    case "skill":
      // skill 注入由 skill dispatcher 完成；这里只生成 user-side 提示文本
      return {
        role: "system",
        content: `[slash] 用户调用了 /skill ${parsed.arg}${parsed.extra ? " " + parsed.extra : ""}（结果已由 backend 注入）`,
      };
    case "attach":
      return {
        role: "system",
        content: `[slash] 用户附加了附件 ${parsed.arg}`,
      };
  }
}