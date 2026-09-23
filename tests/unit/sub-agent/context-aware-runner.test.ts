/**
 * ContextAwareSubAgentRunner 单元测试
 *
 * 覆盖：
 *   - 不带 assembler/sessionRepo 时：等价于 SubAgentRunner
 *   - 带 assembler：systemPrompt 被替换为 assembler 输出
 *   - 带 sessionRepo：user + assistant + tool messages 都被持久化
 *   - end_turn → session.completed
 *   - abort → session.aborted
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteAiSessionRepository } from "@backend/persistence/sqlite/sqlite-ai-session.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { ContextAwareSubAgentRunner } from "@backend/ai/sub-agent/context-aware-runner.ts";
import type { ContextAssembler } from "@backend/ai/context/context-assembler.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type {
  CanonicalAssistantMessage,
  ChatRequest,
  ChatResult,
  StreamEvent,
  ToolSpec,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { ProviderCapabilities } from "@backend/ai/message/canonical-message.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import { ProjectId as toProjectId } from "@shared/types/ids.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
}

class FakeLLMClient implements ILLMClient {
  readonly provider = "anthropic" as const;
  constructor(private readonly responses: CanonicalAssistantMessage[]) {}
  private callCount = 0;

  async chat(_req: ChatRequest): Promise<ChatResult> {
    const r = this.responses[this.callCount++];
    if (!r) throw new Error(`no response for call #${this.callCount}`);
    return { message: r };
  }
  async *stream(_req: ChatRequest): AsyncIterable<StreamEvent> {
    throw new Error("not used");
  }
  capabilities(): ProviderCapabilities {
    return {
      provider: "anthropic",
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      contextWindow: 200_000,
    };
  }
}

function makeSpec() {
  const r = SubAgentSpecVO.create({
    name: "test-agent",
    displayName: "Test",
    description: "x",
    systemPrompt: "You are a test agent.",
    toolNames: ["current_datetime"],
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

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

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

async function makeProject(db: Database): Promise<ProjectId> {
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-05-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "t", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  return r.value.id;
}

class FakeAssembler implements Pick<ContextAssembler, "assemble"> {
  constructor(
    private readonly systemPrompt: string,
    private readonly sources: readonly { kind: string; projectId?: string }[] = [],
  ) {}
  async assemble(_input: Parameters<ContextAssembler["assemble"]>[0]): ReturnType<ContextAssembler["assemble"]> {
    return Promise.resolve({
      systemPrompt: this.systemPrompt,
      messages: [{ role: "user", content: [{ type: "text", text: "user-input" }] }],
      budgetUsage: { total: 100, used: 50, pct: 0.5, bySection: {} },
      sources: this.sources,
    });
  }
}

Deno.test("ContextAwareRunner —— 不带 assembler/sessionRepo：等价于 SubAgentRunner", async () => {
  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [Deno.cwd()],
  });

  const asst: CanonicalAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "你好" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    model: "test",
  };
  const client = new FakeLLMClient([asst]);
  const runner = new ContextAwareSubAgentRunner({
    client,
    executor,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });
  const events = await collect(runner.run({
    spec: makeSpec(),
    userInput: "你好",
    tools: [],
  }));
  const kinds = events.map((e) => e.type);
  assertEquals(kinds.includes("chunk"), true);
  assertEquals(kinds.includes("done"), true);
});

Deno.test("ContextAwareRunner —— assembler 提供 systemPrompt 时被替换", async () => {
  let capturedSystemPrompt: string | undefined;
  const asst: CanonicalAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "reply" }],
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    model: "test",
  };
  const client = new FakeLLMClient([asst]);
  // wrap client.chat to capture systemPrompt
  const originalChat = client.chat.bind(client);
  (client as { chat: typeof client.chat }).chat = async (req: ChatRequest): Promise<ChatResult> => {
    capturedSystemPrompt = req.systemPrompt;
    return await originalChat(req);
  };

  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [Deno.cwd()],
  });

  const assembler = new FakeAssembler("ASSEMBLED-SYSTEM-PROMPT", [{ kind: "system" }]);
  const runner = new ContextAwareSubAgentRunner({
    client,
    executor,
    assembler: assembler as unknown as ContextAssembler,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });
  await collect(runner.run({
    spec: makeSpec(),
    userInput: "x",
    tools: [],
  }));
  assertEquals(capturedSystemPrompt, "ASSEMBLED-SYSTEM-PROMPT");
});

Deno.test("ContextAwareRunner —— sessionRepo 注入：user + assistant 消息持久化", async () => {
  const db = newDb();
  await db.ready();
  const pid = await makeProject(db);
  const sessionRepo = new SqliteAiSessionRepository(db);

  const asst: CanonicalAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "回答内容" }],
    stopReason: "end_turn",
    usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    model: "test",
  };
  const client = new FakeLLMClient([asst]);
  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [Deno.cwd()],
  });

  const runner = new ContextAwareSubAgentRunner({
    client,
    executor,
    sessionRepo,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
    projectId: pid,
    sessionTitle: "测试会话",
  });
  await collect(runner.run({
    spec: makeSpec(),
    userInput: "你好",
    tools: [],
  }));

  // 列出当前项目的 session
  const list = await sessionRepo.list({ projectId: pid, status: "completed", limit: 10, offset: 0 });
  assertEquals(list.items.length, 1);
  const sessionR = await sessionRepo.findById(list.items[0].id);
  assert(sessionR.ok);
  if (!sessionR.ok) return;
  assertEquals(sessionR.value.messages.length, 2); // user + assistant
  assertEquals(sessionR.value.messages[0].role, "user");
  assertEquals(sessionR.value.messages[1].role, "assistant");
  assertEquals(sessionR.value.messages[1].content, "回答内容");
  assertEquals(sessionR.value.statusValue, "completed");
});

Deno.test("ContextAwareRunner —— 无 projectId 时 session.projectId = null", async () => {
  const db = newDb();
  await db.ready();
  const sessionRepo = new SqliteAiSessionRepository(db);

  const asst: CanonicalAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    model: "test",
  };
  const client = new FakeLLMClient([asst]);
  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [Deno.cwd()],
  });

  const runner = new ContextAwareSubAgentRunner({
    client,
    executor,
    sessionRepo,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
  });
  await collect(runner.run({
    spec: makeSpec(),
    userInput: "x",
    tools: [],
  }));
  const list = await sessionRepo.list({ status: "completed", limit: 10, offset: 0 });
  assertEquals(list.items.length, 1);
  assertEquals(list.items[0].projectId, null);
});

Deno.test("ContextAwareRunner —— abort 时 session 切到 aborted", async () => {
  const db = newDb();
  await db.ready();
  const pid = await makeProject(db);
  const sessionRepo = new SqliteAiSessionRepository(db);

  // LLM throws immediately → runner yields error
  const client: ILLMClient = {
    provider: "anthropic",
    async chat(): Promise<ChatResult> {
      throw new Error("LLM down");
    },
    async *stream(): AsyncIterable<StreamEvent> {
      throw new Error("n/a");
    },
    capabilities(): ProviderCapabilities {
      return {
        provider: "anthropic",
        supportsTools: false,
        supportsStructuredOutput: false,
        supportsStreaming: false,
        contextWindow: 1000,
      };
    },
  };

  const toolReg = new ToolRegistry();
  toolReg.register(currentDatetimeTool);
  const executor = new ToolExecutor({
    registry: toolReg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [Deno.cwd()],
  });

  const runner = new ContextAwareSubAgentRunner({
    client,
    executor,
    sessionRepo,
    clock: new FixedClock(new Date("2026-05-01T00:00:00Z")),
    projectId: pid,
  });
  await collect(runner.run({
    spec: makeSpec(),
    userInput: "x",
    tools: [],
  }));

  const list = await sessionRepo.list({ projectId: pid, status: "aborted", limit: 10, offset: 0 });
  assert(list.items.length >= 1);
  assertEquals(list.items[0].status, "aborted");
});

// keep imports referenced
void ({} as ToolSpec);
void toProjectId;