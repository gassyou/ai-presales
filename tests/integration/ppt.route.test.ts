/**
 * /api/projects/:id/ppt/pages[ ... ] 路由集成测试（阶段 7.4c）
 *
 * 覆盖：
 *   - GET / POST 列表 / 新建
 *   - PATCH / DELETE 单条
 *   - POST reorder
 *   - GET export
 *   - POST generate（SSE）：mock client → 消费 StreamEvent
 *   - 边界：empty title 拒绝
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqlitePptPagesRepository } from "@backend/persistence/sqlite/sqlite-ppt-pages.repository.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { PptUseCase } from "@backend/application/business-module/ppt.usecase.ts";
import { handlePpt, type PptRouteDeps } from "@backend/presentation/routes/ppt.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import type {
  ChatRequest,
  ChatResult,
  CanonicalAssistantMessage,
  ProviderCapabilities,
} from "@backend/ai/message/canonical-message.ts";
import type { ILLMClient } from "@backend/ai/client/llm-client.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";

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

function makeConfig(): AppConfig {
  return {
    defaultProfile: "fast",
    profiles: {
      fast: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.5,
        maxTokens: 1024,
      },
    },
  } as unknown as AppConfig;
}

/** mock LLM client：返回固定文本（含 JSON）；用于 generatePages 测试 */
function makeMockClient(text: string): ILLMClient {
  const asst: CanonicalAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    model: "mock-model",
  };
  const chat = async (_req: ChatRequest): Promise<ChatResult> => ({
    message: asst,
  });
  const caps = (): ProviderCapabilities => ({
    provider: "openai",
    supportsTools: false,
    supportsStructuredOutput: false,
    supportsStreaming: false,
    contextWindow: 4096,
  });
  return {
    provider: "openai",
    chat,
    stream: () => (async function* () {})(),
    capabilities: caps,
  };
}

async function setup(opts?: { mockText?: string }): Promise<{
  pid: ProjectId;
  deps: PptRouteDeps;
  resolvePath: (url: string) => string;
}> {
  const db = newDb();
  await db.ready();
  const projRepo = new SqliteProjectRepository(db);
  const clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
  const svc = new ProjectService({ repo: projRepo, clock });
  const r = await svc.createProject({ name: "ppt-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error();
  const repo = new SqlitePptPagesRepository(db);
  const useCase = new PptUseCase(repo, makeLogger(), clock);
  const mockText = opts?.mockText ?? '{"pages":[{"ordinal":1,"title":"封面","prompt":"intro"},{"ordinal":2,"title":"痛点","prompt":"pain"}]}';
  const client = makeMockClient(mockText);
  const deps: PptRouteDeps = {
    useCase,
    logger: makeLogger(),
    config: makeConfig(),
    clientResolver: (_p) => client,
    defaultProfileName: "fast",
  };
  return {
    pid: r.value.id,
    deps,
    resolvePath: (url: string) => url.replace(/^https?:\/[^/]+/, ""),
  };
}

function jsonReq(url: string, body: unknown): Request {
  return new Request(`http://x${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonPatchReq(url: string, body: unknown): Request {
  return new Request(`http://x${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(url: string): Request {
  return new Request(`http://x${url}`, { method: "GET" });
}

function delReq(url: string): Request {
  return new Request(`http://x${url}`, { method: "DELETE" });
}

async function readJson<T>(res: Response): Promise<T> {
  return await res.json() as T;
}

// ---------- 列表 / 新建 ----------

Deno.test("ppt.route — GET 列表空项目 → items=[]", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const res = await handlePpt(getReq(url), deps, resolvePath(url));
  assertEquals(res.status, 200);
  const body = await readJson<{ items: unknown[] }>(res);
  assertEquals(body.items, []);
});

Deno.test("ppt.route — POST 新建 + GET 列表 1 条", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const create = await handlePpt(
    jsonReq(url, { title: "封面", prompt: "intro" }),
    deps,
    resolvePath(url),
  );
  assertEquals(create.status, 201);
  const list = await handlePpt(getReq(url), deps, resolvePath(url));
  const body = await readJson<{ items: Array<{ title: string }> }>(list);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0]?.title, "封面");
});

Deno.test("ppt.route — POST 空 title → 400", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const res = await handlePpt(
    jsonReq(url, { title: "  " }),
    deps,
    resolvePath(url),
  );
  assertEquals(res.status, 400);
});

// ---------- 单条 PATCH / DELETE ----------

Deno.test("ppt.route — PATCH 单条", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const create = await handlePpt(
    jsonReq(url, { title: "A" }),
    deps,
    resolvePath(url),
  );
  const created = await readJson<{ id: string }>(create);
  const itemUrl = `/api/modules/ppt/pages/${created.id}`;
  const upd = await handlePpt(
    jsonPatchReq(itemUrl, { title: "B", prompt: "..." }),
    deps,
    resolvePath(itemUrl),
  );
  assertEquals(upd.status, 200);
  const updated = await readJson<{ title: string; prompt: string }>(upd);
  assertEquals(updated.title, "B");
  assertEquals(updated.prompt, "...");
});

Deno.test("ppt.route — DELETE 单条 → 204", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const create = await handlePpt(
    jsonReq(url, { title: "A" }),
    deps,
    resolvePath(url),
  );
  const created = await readJson<{ id: string }>(create);
  const itemUrl = `/api/modules/ppt/pages/${created.id}`;
  const del = await handlePpt(delReq(itemUrl), deps, resolvePath(itemUrl));
  assertEquals(del.status, 204);
  // 再列应空
  const list = await handlePpt(getReq(url), deps, resolvePath(url));
  const body = await readJson<{ items: unknown[] }>(list);
  assertEquals(body.items.length, 0);
});

Deno.test("ppt.route — PATCH 不存在的 id → 404/400", async () => {
  const { deps, resolvePath } = await setup();
  const url = `/api/modules/ppt/pages/nope`;
  const res = await handlePpt(
    jsonPatchReq(url, { title: "x" }),
    deps,
    resolvePath(url),
  );
  assert(res.status === 404 || res.status === 400);
});

// ---------- Reorder ----------

Deno.test("ppt.route — POST reorder → 200 + 顺序翻转", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const a = await handlePpt(jsonReq(url, { title: "A" }), deps, resolvePath(url));
  const b = await handlePpt(jsonReq(url, { title: "B" }), deps, resolvePath(url));
  const c = await handlePpt(jsonReq(url, { title: "C" }), deps, resolvePath(url));
  const aid = (await readJson<{ id: string }>(a)).id;
  const bid = (await readJson<{ id: string }>(b)).id;
  const cid = (await readJson<{ id: string }>(c)).id;
  const rUrl = `/api/projects/${pid}/ppt/pages/reorder`;
  const r = await handlePpt(
    jsonReq(rUrl, { ids: [cid, aid, bid] }),
    deps,
    resolvePath(rUrl),
  );
  assertEquals(r.status, 200);
  const list = await handlePpt(getReq(url), deps, resolvePath(url));
  const body = await readJson<{ items: Array<{ title: string }> }>(list);
  assertEquals(body.items.map((p) => p.title), ["C", "A", "B"]);
});

Deno.test("ppt.route — reorder 含外部 id → 400", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  const a = await handlePpt(jsonReq(url, { title: "A" }), deps, resolvePath(url));
  const aid = (await readJson<{ id: string }>(a)).id;
  const rUrl = `/api/projects/${pid}/ppt/pages/reorder`;
  const r = await handlePpt(
    jsonReq(rUrl, { ids: [aid, "ghost"] }),
    deps,
    resolvePath(rUrl),
  );
  assertEquals(r.status, 400);
});

// ---------- Export ----------

Deno.test("ppt.route — GET export → markdown 含 H2", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages`;
  await handlePpt(jsonReq(url, { title: "封面", prompt: "intro" }), deps, resolvePath(url));
  await handlePpt(jsonReq(url, { title: "总结", prompt: "end" }), deps, resolvePath(url));
  const eUrl = `/api/projects/${pid}/ppt/pages/export`;
  const res = await handlePpt(getReq(eUrl), deps, resolvePath(eUrl));
  assertEquals(res.status, 200);
  const body = await readJson<{ markdown: string }>(res);
  assert(body.markdown.includes("## 1. 封面"));
  assert(body.markdown.includes("## 2. 总结"));
});

// ---------- Generate SSE ----------

Deno.test("ppt.route — POST generate SSE → ppt_page 流式贴入", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages/generate`;
  const res = await handlePpt(
    jsonReq(url, { userInput: "为 SaaS CRM 设计 8 页 PPT" }),
    deps,
    resolvePath(url),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream; charset=utf-8");

  // 解析 SSE 帧
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<Record<string, unknown>> = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (line.startsWith("data:")) {
          try {
            events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
          } catch {/* dropped */}
        }
      }
    }
  }

  // 应有 2 条 ppt_page + 1 条 done
  const pptEvents = events.filter((e) => e.type === "ppt_page");
  const doneEvents = events.filter((e) => e.type === "done");
  assertEquals(pptEvents.length, 2);
  assertEquals(doneEvents.length, 1);
  assertEquals(pptEvents[0]?.title, "封面");
  assertEquals(pptEvents[1]?.title, "痛点");

  // 后续 list 应包含 2 条
  const listUrl = `/api/projects/${pid}/ppt/pages`;
  const listRes = await handlePpt(getReq(listUrl), deps, resolvePath(listUrl));
  const list = await readJson<{ items: Array<{ title: string; ordinal: number }> }>(listRes);
  assertEquals(list.items.length, 2);
});

Deno.test("ppt.route — POST generate userInput 缺失 → 400", async () => {
  const { pid, deps, resolvePath } = await setup();
  const url = `/api/projects/${pid}/ppt/pages/generate`;
  const res = await handlePpt(
    jsonReq(url, { userInput: "" }),
    deps,
    resolvePath(url),
  );
  assertEquals(res.status, 400);
});

// ---------- Not Found ----------

Deno.test("ppt.route — 未匹配路径 → 404", async () => {
  const { deps, resolvePath } = await setup();
  const url = `/api/projects/abc/ppt/unknown`;
  const res = await handlePpt(getReq(url), deps, resolvePath(url));
  assertEquals(res.status, 404);
});