/**
 * EmbeddingConfigSetting 单元测试 —— 阶段 7.7
 */

import { assertEquals } from "@std/assert";
import { EmbeddingConfigSetting } from "@backend/domain/settings/embedding-config.setting.ts";

Deno.test("EmbeddingConfigSetting —— mock provider 允许无 apiKey/baseUrl", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "mock",
    model: "mock-embed",
    dimension: 0,
  });
  assertEquals(r.ok, true);
});

Deno.test("EmbeddingConfigSetting —— openai 无 apiKey → 校验失败", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 1536,
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error.code, "INVALID_INPUT");
  }
});

Deno.test("EmbeddingConfigSetting —— openai 有 apiKey + baseUrl → 通过", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "openai",
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dimension: 1536,
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.value.provider, "openai");
    assertEquals(r.value.apiKey, "sk-test");
    assertEquals(r.value.dimension, 1536);
  }
});

Deno.test("EmbeddingConfigSetting —— ollama 无 baseUrl → 校验失败", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "ollama",
    model: "nomic-embed-text",
    dimension: 768,
  });
  assertEquals(r.ok, false);
});

Deno.test("EmbeddingConfigSetting —— ollama 有 baseUrl → 通过", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "nomic-embed-text",
    dimension: 768,
  });
  assertEquals(r.ok, true);
});

Deno.test("EmbeddingConfigSetting —— dashscope 无 apiKey → 校验失败", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "dashscope",
    model: "text-embedding-v2",
    dimension: 1536,
  });
  assertEquals(r.ok, false);
});

Deno.test("EmbeddingConfigSetting —— 非法 provider → 校验失败", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "anthropic" as never,
    model: "x",
    dimension: 768,
  });
  assertEquals(r.ok, false);
});

Deno.test("EmbeddingConfigSetting —— 缺 model → 校验失败", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "mock",
    model: "",
    dimension: 0,
  });
  assertEquals(r.ok, false);
});

Deno.test("EmbeddingConfigSetting —— 非法 dimension（>4096） → 校验失败", () => {
  const r = EmbeddingConfigSetting.create({
    provider: "mock",
    model: "x",
    dimension: 9999,
  });
  assertEquals(r.ok, false);
});

Deno.test("EmbeddingConfigSetting.defaultMock —— 返回 mock 占位", () => {
  const d = EmbeddingConfigSetting.defaultMock();
  assertEquals(d.provider, "mock");
  assertEquals(d.model, "mock-embed");
  assertEquals(d.dimension, 0);
});