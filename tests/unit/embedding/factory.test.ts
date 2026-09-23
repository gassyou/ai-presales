/**
 * Embedding factory + providers 单元测试
 *
 * 阶段 7.7：factory 接受 settings 风格的 EmbeddingConfigSettingData
 * （provider/baseUrl/apiKey/model/dimension 平铺）；删除 forceMock。
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { MockEmbeddingProvider } from "@backend/ai/embedding/mock-embedding.provider.ts";
import { OllamaEmbeddingProvider } from "@backend/ai/embedding/ollama-embedding.provider.ts";
import { OpenAIEmbeddingProvider } from "@backend/ai/embedding/openai-embedding.provider.ts";
import { DashScopeEmbeddingProvider } from "@backend/ai/embedding/dashscope-embedding.provider.ts";
import {
  EmbeddingUnavailableError,
} from "@backend/ai/embedding/embedding-provider.ts";
import { createEmbeddingProvider } from "@backend/ai/embedding/factory.ts";

Deno.test("MockEmbedding —— 同文本 → 同向量（确定性）", async () => {
  const p = new MockEmbeddingProvider({ dimension: 128 });
  const a = await p.embed(["hello"]);
  const b = await p.embed(["hello"]);
  assertEquals(a.length, 1);
  assertEquals(a[0].length, 128);
  for (let i = 0; i < 128; i++) {
    assertEquals(a[0][i], b[0][i]);
  }
});

Deno.test("MockEmbedding —— 不同文本 → 不同向量", async () => {
  const p = new MockEmbeddingProvider({ dimension: 64 });
  const v = await p.embed(["hello", "world"]);
  let different = false;
  for (let i = 0; i < 64; i++) {
    if (v[0][i] !== v[1][i]) {
      different = true;
      break;
    }
  }
  assertEquals(different, true);
});

Deno.test("MockEmbedding —— normalize=true 时 L2 norm ≈ 1", async () => {
  const p = new MockEmbeddingProvider({ dimension: 32, normalize: true });
  const v = await p.embed(["hello"]);
  let sum = 0;
  for (const x of v[0]) sum += x * x;
  const norm = Math.sqrt(sum);
  assert(Math.abs(norm - 1) < 1e-5);
});

Deno.test("MockEmbedding —— 空数组 → 空结果", async () => {
  const p = new MockEmbeddingProvider();
  assertEquals(await p.embed([]), []);
});

Deno.test("factory —— provider=mock → 返回 MockEmbeddingProvider", () => {
  const p = createEmbeddingProvider({
    config: { provider: "mock", model: "mock-embed", dimension: 0 },
  });
  assertEquals(p.providerName, "mock");
});

Deno.test("factory —— provider=ollama 缺 baseUrl → EmbeddingUnavailableError", () => {
  assertThrowsEmbedding(
    () => createEmbeddingProvider({
      config: { provider: "ollama", model: "nomic-embed", dimension: 768 },
    }),
  );
});

Deno.test("factory —— provider=ollama 有 baseUrl → OllamaEmbeddingProvider", () => {
  const p = createEmbeddingProvider({
    config: {
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "nomic-embed",
      dimension: 768,
    },
  });
  assertEquals(p.providerName, "ollama");
});

Deno.test("factory —— provider=openai 缺 apiKey → EmbeddingUnavailableError", () => {
  assertThrowsEmbedding(
    () => createEmbeddingProvider({
      config: { provider: "openai", model: "text-embedding-3-small", dimension: 1536 },
    }),
  );
});

Deno.test("factory —— provider=openai 有 apiKey → OpenAIEmbeddingProvider", () => {
  const p = createEmbeddingProvider({
    config: {
      provider: "openai",
      apiKey: "k",
      model: "text-embedding-3-small",
      dimension: 1536,
    },
  });
  assertEquals(p.providerName, "openai");
});

Deno.test("factory —— provider=openai 用 env OPENAI_API_KEY", () => {
  const p = createEmbeddingProvider({
    config: {
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 1536,
    },
    env: { OPENAI_API_KEY: "env-key" },
  });
  assertEquals(p.providerName, "openai");
});

Deno.test("factory —— provider=dashscope 缺 apiKey → EmbeddingUnavailableError", () => {
  assertThrowsEmbedding(
    () => createEmbeddingProvider({
      config: { provider: "dashscope", model: "text-embedding-v2", dimension: 1536 },
    }),
  );
});

Deno.test("factory —— provider=dashscope 有 apiKey → DashScopeEmbeddingProvider", () => {
  const p = createEmbeddingProvider({
    config: {
      provider: "dashscope",
      apiKey: "k",
      model: "text-embedding-v2",
      dimension: 1536,
    },
  });
  assertEquals(p.providerName, "dashscope");
});

Deno.test("OllamaEmbedding —— embed 失败 → EmbeddingUnavailableError", async () => {
  const p = new OllamaEmbeddingProvider({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
  await assertRejects(
    () => p.embed(["hello"]),
    EmbeddingUnavailableError,
  );
});

Deno.test("OpenAIEmbedding —— 构造时缺 apiKey → EmbeddingUnavailableError", () => {
  assertThrowsEmbedding(() => new OpenAIEmbeddingProvider({ apiKey: "" }));
});

Deno.test("DashScopeEmbedding —— 构造时缺 apiKey → EmbeddingUnavailableError", () => {
  assertThrowsEmbedding(() => new DashScopeEmbeddingProvider({ apiKey: "" }));
});

function assertThrowsEmbedding(fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof EmbeddingUnavailableError) return;
    throw new Error(`expected EmbeddingUnavailableError, got ${(e as Error).name ?? typeof e}: ${(e as Error).message ?? e}`);
  }
  throw new Error("expected EmbeddingUnavailableError to be thrown, but no error was thrown");
}