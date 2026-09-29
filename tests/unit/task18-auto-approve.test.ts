/**
 * 任务 18（阶段 13 / PR #8）：会话级"全部自动批准"开关 —— 测试
 *
 * 覆盖：
 *   - migration 016 注册
 *   - ChatSession DTO 默认 autoApprove=false
 *   - ChatSessionUseCase.setAutoApprove 真写库 + 返回新 DTO
 *   - SqliteChatSessionRepository.setAutoApprove 真写库
 *   - PATCH /api/chat/sessions/:id {autoApprove:true} → 200 + 真切
 *   - PATCH {autoApprove:false} 也支持
 *   - PATCH 空 body → 400
 *   - PATCH {autoApprove:true} 但 sessionId 不存在 → 404
 *   - ToolExecutor forceApproveAll=true 跳过 requiresApproval
 *   - ToolExecutor forceApproveAll=false 仍要求审批
 *   - ToolExecutor forceApproveAll=true 但有 forceReject → 仍拒绝
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteChatSessionRepository } from "@backend/persistence/sqlite/sqlite-chat-session.repository.ts";
import { ChatSessionUseCase } from "@backend/application/chat-session/chat-session.usecase.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import { ChatSession } from "@backend/domain/chat-session/chat-session.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import {
  type ChatSessionRouteDeps,
  handleChatSession,
} from "@backend/presentation/routes/chat-session.route.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import type { IToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

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

function silentLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => silentLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  } as unknown as Logger;
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

function makeUseCase(db: Database): ChatSessionUseCase {
  return new ChatSessionUseCase({
    repo: new SqliteChatSessionRepository(db),
    clock: new FixedClock(new Date("2026-03-01T00:00:00Z")),
  });
}

async function seedSession(db: Database, useCase: ChatSessionUseCase): Promise<string> {
  const r = useCase.createSession({
    projectId: null as ProjectId | null,
    title: "测试会话",
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.id;
}

Deno.test({
  name: "t18 — migration 016 在 builtin 列表中",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { BUILTIN_MIGRATIONS } = await import(
      "@backend/persistence/database/migrations/index.ts"
    );
    const ids = BUILTIN_MIGRATIONS.map((m) => m.id);
    assert(ids.includes("016_session_auto_approve"), `016 应在 migrations, got ${ids.join(",")}`);
  },
});

Deno.test({
  name: "t18 — ChatSession.create 默认 autoApprove=false",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const r = ChatSession.create({
      id: "id-1",
      projectId: null,
      title: "t",
      now: new Date("2026-03-01T00:00:00Z"),
    });
    assert(r.ok);
    if (!r.ok) return;
    assertEquals(r.value.autoApprove, false);
    const dto = r.value.toDTO();
    assertEquals(dto.autoApprove, false);
  },
});

Deno.test({
  name: "t18 — ChatSession.setAutoApprove 改字段 + DTO 反映",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const r = ChatSession.create({
      id: "id-1",
      projectId: null,
      title: "t",
      now: new Date("2026-03-01T00:00:00Z"),
    });
    if (!r.ok) throw new Error("create failed");
    const s = r.value;
    s.setAutoApprove(true);
    assertEquals(s.autoApprove, true);
    assertEquals(s.toDTO().autoApprove, true);
    s.setAutoApprove(false);
    assertEquals(s.toDTO().autoApprove, false);
  },
});

Deno.test({
  name: "t18 — repo.createSession 写入 auto_approve=0；setAutoApprove 真改",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const repo = new SqliteChatSessionRepository(db);
    const s = ChatSession.create({
      id: "id-1",
      projectId: null,
      title: "t",
      now: new Date("2026-03-01T00:00:00Z"),
    });
    if (!s.ok) throw new Error("create failed");
    repo.createSession(s.value);
    // 默认 0
    const rows0 = db.query<{ auto_approve: number }>(
      `SELECT auto_approve FROM chat_sessions WHERE id=?`,
      ["id-1"],
    );
    assertEquals(rows0[0]?.auto_approve, 0);
    // setAutoApprove(true)
    const ok = repo.setAutoApprove("id-1", true);
    assertEquals(ok, true);
    const rows1 = db.query<{ auto_approve: number }>(
      `SELECT auto_approve FROM chat_sessions WHERE id=?`,
      ["id-1"],
    );
    assertEquals(rows1[0]?.auto_approve, 1);
    // 再 setAutoApprove(false)
    repo.setAutoApprove("id-1", false);
    const rows2 = db.query<{ auto_approve: number }>(
      `SELECT auto_approve FROM chat_sessions WHERE id=?`,
      ["id-1"],
    );
    assertEquals(rows2[0]?.auto_approve, 0);
  },
});

Deno.test({
  name: "t18 — useCase.setAutoApprove 返新 DTO + 更新内存对象",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const useCase = makeUseCase(db);
    const id = await seedSession(db, useCase);

    const r = useCase.setAutoApprove(id, true);
    assert(r.ok);
    if (!r.ok) return;
    assertEquals(r.value.autoApprove, true);
    assertEquals(r.value.id, id);

    const r2 = useCase.setAutoApprove(id, false);
    assert(r2.ok);
    if (!r2.ok) return;
    assertEquals(r2.value.autoApprove, false);

    // 不存在的 id → NOT_FOUND
    const r3 = useCase.setAutoApprove("no-such", true);
    assertEquals(r3.ok, false);
    if (!r3.ok) assertEquals(r3.error.code, "NOT_FOUND");
  },
});

Deno.test({
  name: "t18 — PATCH /api/chat/sessions/:id {autoApprove:true} → 200 + 真切",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const useCase = makeUseCase(db);
    const id = await seedSession(db, useCase);
    const deps: ChatSessionRouteDeps = { logger: silentLogger(), useCase };
    const req = await jsonReq(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      body: { autoApprove: true },
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const dto = await resp.json();
    assertEquals(dto.autoApprove, true);
    assertEquals(dto.id, id);
  },
});

Deno.test({
  name: "t18 — PATCH {autoApprove:false} 也支持",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const useCase = makeUseCase(db);
    const id = await seedSession(db, useCase);
    // 先开
    useCase.setAutoApprove(id, true);
    const deps: ChatSessionRouteDeps = { logger: silentLogger(), useCase };
    const req = await jsonReq(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      body: { autoApprove: false },
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 200);
    const dto = await resp.json();
    assertEquals(dto.autoApprove, false);
  },
});

Deno.test({
  name: "t18 — PATCH 空 body → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const useCase = makeUseCase(db);
    const id = await seedSession(db, useCase);
    const deps: ChatSessionRouteDeps = { logger: silentLogger(), useCase };
    const req = await jsonReq(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      body: {},
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 400);
  },
});

Deno.test({
  name: "t18 — PATCH autoApprove 但 sessionId 不存在 → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await db.ready();
    const useCase = makeUseCase(db);
    const deps: ChatSessionRouteDeps = { logger: silentLogger(), useCase };
    const req = await jsonReq(`/api/chat/sessions/no-such`, {
      method: "PATCH",
      body: { autoApprove: true },
    });
    const resp = await handleChatSession(req, deps, new URL(req.url));
    assertEquals(resp.status, 404);
  },
});

// ---- ToolExecutor forceApproveAll ----

interface StubTool {
  name: string;
  requiresApproval: boolean;
  execute: (args: unknown, ctx: unknown) => Promise<{ ok: true; value: string }>;
}

function makeReg(tool: StubTool): IToolRegistry {
  const map = new Map<string, StubTool>();
  map.set(tool.name, tool);
  return {
    get: (n: string) => map.get(n) as never,
    has: (n: string) => map.has(n),
    list: () => Array.from(map.values()) as never,
    names: () => Array.from(map.keys()),
    register: () => {},
    toLLMTools: () => [],
  };
}

Deno.test({
  name: "t18 — ToolExecutor forceApproveAll=false 仍要求审批",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tool: StubTool = {
      name: "write_x",
      requiresApproval: true,
      execute: async () => ({ ok: true, value: "ok" }),
    };
    const exec = new ToolExecutor({
      registry: makeReg(tool),
      logger: silentLogger(),
      cwd: "/tmp",
      allowedPaths: [],
    });
    const r = await exec.executeOne({
      toolCallId: "tc-1",
      name: "write_x",
      args: {},
    });
    assertEquals(r.ok, false);
    if (r.ok) return;
    assertEquals(r.error, "APPROVAL_REQUIRED");
    assertEquals(r.awaitingApproval, true);
  },
});

Deno.test({
  name: "t18 — ToolExecutor forceApproveAll=true 跳过 requiresApproval",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let invoked = false;
    const tool: StubTool = {
      name: "write_x",
      requiresApproval: true,
      execute: async () => {
        invoked = true;
        return { ok: true, value: "ok" };
      },
    };
    const exec = new ToolExecutor({
      registry: makeReg(tool),
      logger: silentLogger(),
      cwd: "/tmp",
      allowedPaths: [],
      forceApproveAll: true,
    });
    const r = await exec.executeOne({
      toolCallId: "tc-1",
      name: "write_x",
      args: {},
    });
    assertEquals(r.ok, true);
    assertEquals(invoked, true);
    if (r.ok) assertEquals(r.content, "ok");
  },
});

Deno.test({
  name: "t18 — ToolExecutor forceApproveAll=true 但 forceReject 仍拒绝",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tool: StubTool = {
      name: "write_x",
      requiresApproval: true,
      execute: async () => ({ ok: true, value: "ok" }),
    };
    const exec = new ToolExecutor({
      registry: makeReg(tool),
      logger: silentLogger(),
      cwd: "/tmp",
      allowedPaths: [],
      forceApproveAll: true,
      forceRejectNames: ["write_x"],
    });
    const r = await exec.executeOne({
      toolCallId: "tc-1",
      name: "write_x",
      args: {},
    });
    assertEquals(r.ok, false);
    if (r.ok) return;
    assertEquals(r.error, "USER_REJECTED");
  },
});

// ---- frontend api 类型断言 ----

Deno.test({
  name: "t18 — ChatSessionDTO 含 autoApprove 字段",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/ai-chat/api/chat-session.api.ts",
    );
    assertStringIncludes(src, "autoApprove");
  },
});

Deno.test({
  name: "t18 — ai-chat.store 暴露 autoApprove + setAutoApprove",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/ai-chat/stores/ai-chat.store.ts",
    );
    assertStringIncludes(src, "autoApprove");
    assertStringIncludes(src, "setAutoApprove");
  },
});

Deno.test({
  name: "t18 — ChatComposer 渲染 auto-approve switch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/features/ai-chat/ChatComposer.vue",
    );
    assertStringIncludes(src, "el-switch");
    assertStringIncludes(src, "全自动");
    assertStringIncludes(src, "onAutoApproveChange");
    // 真正绑定到 store.autoApprove
    assertStringIncludes(src, "store.autoApprove");
  },
});

// 辅助占位：保留 assertExists 导入（防止某些环境 unused 警告）
void assertExists;
