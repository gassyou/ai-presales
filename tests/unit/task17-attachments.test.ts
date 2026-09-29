/**
 * 任务 17（阶段 13 / PR #7）：chat 附件上传 —— 测试
 *
 * 覆盖：
 *   - HTTP POST /api/chat/sessions/:id/attachments 写入文件 + 创建 chat_attachments 行 + appendMessage
 *   - HTTP GET /api/chat/sessions/:id/attachments 列出附件
 *   - HTTP POST 缺 fileName → 400
 *   - HTTP POST 缺 contentBase64 + contentText → 400
 *   - HTTP POST sessionId 不存在 → 404
 *   - 上传 > 10MB 文件 → 413
 *   - uploadAttachment 把 storagePath 写到 dataDir/chat-attachments/<sessionId>/ 下
 *   - 真实文件在磁盘上可读
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { ChatAttachmentUseCase } from "@backend/application/chat-attachment/chat-attachment.usecase.ts";
import { SqliteChatAttachmentRepository } from "@backend/persistence/sqlite/sqlite-chat-attachment.repository.ts";
import { SqliteChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import { Database } from "@backend/persistence/database/database.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import {
  type ChatAttachmentRouteDeps,
  handleChatAttachmentRoute,
} from "@backend/presentation/routes/chat-attachment.route.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ChatRequest, ChatResult, ILLMClient } from "@backend/ai/client/llm-client.ts";

function newDb(): Database {
  return new Database({
    paths: {
      root: "/tmp/whatever",
      data: "/tmp/whatever",
      logs: "/tmp/whatever",
      vendor: "/tmp/whatever",
      output: "/tmp/whatever",
    },
    inMemory: true,
    skipExtensions: true,
  });
}

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  } as unknown as Logger;
}

function fakeLlmClient(answer = "AI 摘要"): ILLMClient {
  return {
    provider: "openai",
    async chat(_req: ChatRequest): Promise<ChatResult> {
      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: answer }],
          stopReason: "end_turn",
          model: "fake",
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
    async *stream() {
      yield { type: "done" };
    },
    capabilities() {
      return {
        provider: "openai",
        supportsTools: false,
        supportsStreaming: true,
        supportsStructuredOutput: false,
        contextWindow: 128000,
      };
    },
  };
}

async function setupRoute(): Promise<{
  deps: ChatAttachmentRouteDeps;
}> {
  // fileName 校验先于 session 查找，db 用最小初始化即可
  const db = newDb();
  await db.ready();
  const useCase = new ChatAttachmentUseCase({
    repo: new SqliteChatAttachmentRepository(db),
    chatSessionRepo: new SqliteChatSessionRepository(db),
    llmClient: fakeLlmClient(),
    defaultProfile: { provider: "openai", model: "gpt-4o-mini", temperature: 0.2, maxTokens: 2048 },
    storageDir: await Deno.makeTempDir({ prefix: "attach-test-" }),
    clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
  });
  return {
    deps: { logger: makeLogger(), useCase },
  };
}

async function jsonReq(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Request> {
  const { method = "GET", body } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// 直接用 use case 的 test —— 跳过 route 的 session 创建，单独建一个 session
async function newSession(db: Database): Promise<string> {
  const repo = new SqliteChatSessionRepository(db);
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, null, "t", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z"],
  );
  return id;
}

Deno.test({
  name:
    "t17 — POST /api/chat/sessions/:id/attachments 写入文件 + chat_attachments 行 + appendMessage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const storageDir = await Deno.makeTempDir({ prefix: "attach-test-" });
    const sessionId = await newSession(db);
    const useCase = new ChatAttachmentUseCase({
      repo: new SqliteChatAttachmentRepository(db),
      chatSessionRepo: new SqliteChatSessionRepository(db),
      llmClient: fakeLlmClient("AI 摘要：测试内容"),
      defaultProfile: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 2048,
      },
      storageDir,
      clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
    });
    const deps: ChatAttachmentRouteDeps = { logger: makeLogger(), useCase };
    const text = "hello world";
    const contentBase64 = btoa(text);
    const req = await jsonReq(`/api/chat/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: { fileName: "hi.txt", mimeType: "text/plain", contentBase64 },
    });
    const resp = await handleChatAttachmentRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 201);
    const dto = await resp.json();
    assertEquals(dto.fileName, "hi.txt");
    assertEquals(dto.mimeType, "text/plain");
    assertEquals(dto.sizeBytes, text.length);
    assertEquals(dto.parsedSummary, "AI 摘要：测试内容");
    assertExists(dto.id);

    // 文件确实存在 + 可读
    const filePath = `${storageDir}/${sessionId}/${dto.id}_hi.txt`;
    const buf = await Deno.readFile(filePath);
    assertEquals(new TextDecoder().decode(buf), text);

    // chat_attachments 行存在
    const rows = db.query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM chat_attachments WHERE session_id = ?`,
      [sessionId],
    );
    assertEquals(rows[0]?.c, 1);

    // chat_messages 行存在（user + attachment_upload tool_call）
    const msgs = db.query<{ role: string; content: string }>(
      `SELECT role, content FROM chat_messages WHERE session_id = ?`,
      [sessionId],
    );
    assertEquals(msgs.length, 1);
    assertEquals(msgs[0].role, "user");
    assertStringIncludes(msgs[0].content, "[attachment] hi.txt");
  },
});

Deno.test({
  name: "t17 — GET /api/chat/sessions/:id/attachments 列附件",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const sessionId = await newSession(db);
    const useCase = new ChatAttachmentUseCase({
      repo: new SqliteChatAttachmentRepository(db),
      chatSessionRepo: new SqliteChatSessionRepository(db),
      llmClient: fakeLlmClient(),
      defaultProfile: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 2048,
      },
      storageDir: await Deno.makeTempDir({ prefix: "attach-test-" }),
      clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
    });
    const deps: ChatAttachmentRouteDeps = { logger: makeLogger(), useCase };
    await useCase.upload({
      sessionId,
      fileName: "a.txt",
      mimeType: "text/plain",
      contentText: "alpha",
    });
    await useCase.upload({
      sessionId,
      fileName: "b.txt",
      mimeType: "text/plain",
      contentText: "beta",
    });
    const req = await jsonReq(`/api/chat/sessions/${sessionId}/attachments`);
    const resp = await handleChatAttachmentRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.items.length, 2);
    const names = body.items.map((i: { fileName: string }) => i.fileName).sort();
    assertEquals(names[0], "a.txt");
    assertEquals(names[1], "b.txt");
  },
});

Deno.test({
  name: "t17 — POST 缺 fileName → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { deps } = await setupRoute();
    const req = await jsonReq(`/api/chat/sessions/some-id/attachments`, {
      method: "POST",
      body: { mimeType: "text/plain", contentText: "hi" },
    });
    const resp = await handleChatAttachmentRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 400);
  },
});

Deno.test({
  name: "t17 — POST 缺 contentBase64 + contentText → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const sessionId = await newSession(db);
    const useCase = new ChatAttachmentUseCase({
      repo: new SqliteChatAttachmentRepository(db),
      chatSessionRepo: new SqliteChatSessionRepository(db),
      llmClient: fakeLlmClient(),
      defaultProfile: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 2048,
      },
      storageDir: await Deno.makeTempDir({ prefix: "attach-test-" }),
      clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
    });
    const deps: ChatAttachmentRouteDeps = { logger: makeLogger(), useCase };
    const req = await jsonReq(`/api/chat/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: { fileName: "x.txt", mimeType: "text/plain" },
    });
    const resp = await handleChatAttachmentRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 400);
  },
});

Deno.test({
  name: "t17 — POST sessionId 不存在 → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const useCase = new ChatAttachmentUseCase({
      repo: new SqliteChatAttachmentRepository(db),
      chatSessionRepo: new SqliteChatSessionRepository(db),
      llmClient: fakeLlmClient(),
      defaultProfile: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 2048,
      },
      storageDir: await Deno.makeTempDir({ prefix: "attach-test-" }),
      clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
    });
    const deps: ChatAttachmentRouteDeps = { logger: makeLogger(), useCase };
    const req = await jsonReq(`/api/chat/sessions/no-such-session/attachments`, {
      method: "POST",
      body: { fileName: "x.txt", mimeType: "text/plain", contentText: "hi" },
    });
    const resp = await handleChatAttachmentRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 404);
  },
});

Deno.test({
  name: "t17 — POST > 10MB 文件 → 413",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const sessionId = await newSession(db);
    const useCase = new ChatAttachmentUseCase({
      repo: new SqliteChatAttachmentRepository(db),
      chatSessionRepo: new SqliteChatSessionRepository(db),
      llmClient: fakeLlmClient(),
      defaultProfile: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 2048,
      },
      storageDir: await Deno.makeTempDir({ prefix: "attach-test-" }),
      clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
    });
    const deps: ChatAttachmentRouteDeps = { logger: makeLogger(), useCase };
    // 11MB
    const big = "x".repeat(11 * 1024 * 1024);
    const contentBase64 = btoa(big);
    const req = await jsonReq(`/api/chat/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: { fileName: "big.bin", mimeType: "application/octet-stream", contentBase64 },
    });
    const resp = await handleChatAttachmentRoute(req, deps, new URL(req.url));
    assertEquals(resp.status, 413);
  },
});

Deno.test({
  name: "t17 — migration 015 在 builtin 列表中",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { BUILTIN_MIGRATIONS } = await import(
      "@backend/persistence/database/migrations/index.ts"
    );
    const ids = BUILTIN_MIGRATIONS.map((m) => m.id);
    assert(
      ids.includes("015_chat_attachments"),
      `015_chat_attachments 应在 migrations, got ${ids}`,
    );
  },
});
