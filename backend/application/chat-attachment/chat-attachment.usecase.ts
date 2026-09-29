/**
 * ChatAttachmentUseCase —— 阶段 13（PR #7 / 用户项 #8）
 *
 * 业务流：
 *   1. 校验 sessionId 存在；
 *   2. 解码 base64（缺省走 contentText 路径）；
 *   3. 校验 size ≤ 10 MB；
 *   4. 落盘到 dataDir/chat-attachments/<sessionId>/<id>_<fileName>；
 *   5. 异步触发 LLM 解析（summary 入 chat_attachments.parsed_summary）；
 *   6. 在 chat_messages 插入一条 role=user 的占位消息（content 标记 [attachment: ...]），
 *      让 chat history 可见附件；详细元数据走 tool_calls_json 序列化为结构化字段；
 *   7. 返回 ChatAttachmentRecord + parsedSummary。
 *
 * 错误约定：
 *   - 抛 Error（"session not found" / "size exceeds limit" / "contentBase64 or contentText required"）。
 *   - LLM 解析失败 → parsed_summary = null（不抛）；前端按需显示 "AI 解析失败"。
 */
import type { ChatAttachmentRecord } from "@backend/persistence/sqlite/sqlite-chat-attachment.repository.ts";
import type { IChatAttachmentRepository } from "@backend/persistence/sqlite/sqlite-chat-attachment.repository.ts";
import type { IChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ProfileConfig } from "@backend/infrastructure/config/types.ts";
import type { Clock } from "@backend/domain/shared/clock.ts";
import { SystemClock } from "@backend/domain/shared/clock.ts";
import type { ChatMessageDTO } from "@backend/domain/chat-session/chat-session.ts";
import { newId } from "@shared/types/ids.ts";

export interface ChatAttachmentUseCaseDeps {
  readonly repo: IChatAttachmentRepository;
  readonly chatSessionRepo: IChatSessionRepository;
  readonly llmClient: ILLMClient;
  readonly defaultProfile: ProfileConfig;
  readonly storageDir: string;
  readonly clock?: Clock;
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export class ChatAttachmentUseCase {
  private readonly maxBytes: number;
  private readonly clock: Clock;

  constructor(private readonly deps: ChatAttachmentUseCaseDeps) {
    this.maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    this.clock = deps.clock ?? new SystemClock();
  }

  async upload(args: {
    sessionId: string;
    fileName: string;
    mimeType: string;
    contentBase64?: string;
    contentText?: string;
  }): Promise<ChatAttachmentRecord> {
    const session = this.deps.chatSessionRepo.findSessionById(args.sessionId);
    if (!session) {
      throw new Error(`session not found: ${args.sessionId}`);
    }
    let buf: Uint8Array;
    if (typeof args.contentBase64 === "string" && args.contentBase64.length > 0) {
      const decoded = atob(args.contentBase64);
      buf = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) buf[i] = decoded.charCodeAt(i);
    } else if (typeof args.contentText === "string" && args.contentText.length > 0) {
      buf = new TextEncoder().encode(args.contentText);
    } else {
      throw new Error("contentBase64 or contentText required");
    }
    if (buf.byteLength > this.maxBytes) {
      throw new Error(`size exceeds limit ${this.maxBytes} bytes`);
    }

    const id = newId<"KnowledgeItemId">();
    const dir = `${this.deps.storageDir}/${args.sessionId}`;
    await Deno.mkdir(dir, { recursive: true });
    const safeName = args.fileName.replace(/[\\/]/g, "_");
    const path = `${dir}/${id}_${safeName}`;
    await Deno.writeFile(path, buf);

    // 异步触发 LLM 解析；失败不阻塞 upload
    const summary = await this.tryParseSummary(args.fileName, args.mimeType, args.contentText, buf);

    const rec: ChatAttachmentRecord = {
      id,
      sessionId: args.sessionId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: buf.byteLength,
      storagePath: path,
      parsedSummary: summary,
      createdAt: this.clock.now(),
    };
    this.deps.repo.create(rec);

    // 在 chat_messages 插入一条 user 消息标记附件；前端用 tool_calls_json 渲染
    const userMsg: ChatMessageDTO = {
      id: newId<"MessageId">(),
      sessionId: args.sessionId,
      role: "user",
      content: `[attachment] ${args.fileName} (${args.mimeType}, ${buf.byteLength}B)`,
      toolCalls: [
        {
          id: `attach-${id}`,
          name: "attachment_upload",
          args: {
            attachmentId: id,
            fileName: args.fileName,
            mimeType: args.mimeType,
            sizeBytes: buf.byteLength,
          },
          ok: true,
          result: summary ?? "(AI 解析失败)",
          durationMs: 0,
        },
      ],
      createdAt: this.clock.now(),
    };
    this.deps.chatSessionRepo.appendMessage(userMsg);
    session.touch(userMsg.createdAt);

    return rec;
  }

  listBySession(sessionId: string): ChatAttachmentRecord[] {
    return this.deps.repo.listBySession(sessionId);
  }

  private async tryParseSummary(
    fileName: string,
    mimeType: string,
    contentText: string | undefined,
    buf: Uint8Array,
  ): Promise<string | null> {
    try {
      const userInput = contentText
        ? `文件：${fileName}\nMIME：${mimeType}\n\n内容（前 4000 字符）：\n${
          contentText.slice(0, 4000)
        }`
        : `文件：${fileName}\nMIME：${mimeType}\n\n内容（前 4000 字节）：\n${
          new TextDecoder().decode(buf.slice(0, 4000))
        }`;
      const req = {
        systemPrompt:
          "你是附件内容摘要助手。请用 1-2 句话总结附件核心内容并提取关键实体。中文输出。不要 markdown 围栏。",
        messages: [{
          role: "user" as const,
          content: [{ type: "text" as const, text: userInput }],
        }],
        model: this.deps.defaultProfile.model,
        temperature: 0.2,
        maxOutputTokens: 512,
        signal: undefined,
      };
      const result = await this.deps.llmClient.chat(req);
      const text = result.message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
      if (text.trim().length === 0) return null;
      return text.trim();
    } catch {
      return null;
    }
  }
}
