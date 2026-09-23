/**
 * server.ts 单元测试
 *
 * 验证：
 *   - /api/health 返回 200
 *   - 404 命中
 *   - ErrorEnvelope 透传
 *   - 静态资源（SPA fallback）
 */

import { assertEquals, assertExists } from "@std/assert";
import { createApp, type App } from "@backend/presentation/server.ts";
import { createLogger } from "@backend/infrastructure/logging/logger.ts";
import type { AppConfig } from "@backend/infrastructure/config/types.ts";
import { join } from "@std/path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const fakeConfig: AppConfig = {
  app: { name: "test", version: "0.0.1", dataDir: "/tmp/test" },
  server: { host: "127.0.0.1", port: 8000 },
  profiles: {
    fast: { provider: "anthropic", model: "claude-haiku-4-5", temperature: 0.2, maxTokens: 2048 },
  },
  defaultProfile: "fast",
  knowledge: {
    ragTopK: 5,
    ragMinScore: 0.75,
    embeddingProvider: "openai",
    embeddingModel: "x",
    embeddingDim: 1536,
    chunkMaxTokens: 500,
    chunkOverlapTokens: 50,
    softFallbackOnVecMissing: true,
  },
  security: { tool_require_approval: [], allowedPaths: [] } as unknown as AppConfig["security"],
  output: { defaultOutputDir: "/tmp" },
  logging: { level: "error", maxSizeMb: 10, maxBackups: 5 },
};

async function setupStatic(): Promise<{ root: string; cleanup: () => void }> {
  const dir = join(tmpdir(), `ai-presales-static-${crypto.randomUUID()}`);
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<html><body>app</body></html>");
  writeFileSync(join(dir, "assets", "main.js"), "console.log('hi');");
  return {
    root: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeApp(opts: { staticRoot?: string; devMode?: boolean }): App {
  return createApp({
    config: fakeConfig,
    logger: createLogger({ level: "error" }),
    staticRoot: opts.staticRoot,
    devMode: opts.devMode ?? false,
    dbProbe: undefined,
    llmProbe: async () => ({ ok: true, providers: ["fast"] }),
  });
}

Deno.test("GET /api/health - 200 + 包含 checks", async () => {
  const app = makeApp({});
  const res = await app.fetch(new Request("http://x/api/health"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
  assertExists(body.checks);
  assertEquals(body.checks.providers[0], "fast");
});

Deno.test("GET /api/unknown - 404 + ErrorEnvelope", async () => {
  const app = makeApp({});
  const res = await app.fetch(new Request("http://x/api/nope"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.code, "NOT_FOUND");
  assertExists(body.traceId);
});

Deno.test("GET / - 静态资源命中 index.html", async () => {
  const { root, cleanup } = await setupStatic();
  try {
    const app = makeApp({ staticRoot: root });
    const res = await app.fetch(new Request("http://x/"));
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(text, "<html><body>app</body></html>");
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  } finally {
    cleanup();
  }
});

Deno.test("GET /assets/main.js - 静态资源命中 js", async () => {
  const { root, cleanup } = await setupStatic();
  try {
    const app = makeApp({ staticRoot: root });
    const res = await app.fetch(new Request("http://x/assets/main.js"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/javascript; charset=utf-8");
  } finally {
    cleanup();
  }
});

Deno.test("GET /some/spa/route - SPA fallback 返回 index.html", async () => {
  const { root, cleanup } = await setupStatic();
  try {
    const app = makeApp({ staticRoot: root });
    const res = await app.fetch(new Request("http://x/some/spa/route"));
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(text, "<html><body>app</body></html>");
  } finally {
    cleanup();
  }
});

Deno.test("GET /  - 无 staticRoot 时返回 404", async () => {
  const app = makeApp({});
  const res = await app.fetch(new Request("http://x/"));
  assertEquals(res.status, 404);
});