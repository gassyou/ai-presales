/**
 * 配置加载器单元测试
 *
 * 用临时 config.toml 走 zod 校验 → 字段映射 → ${ENV_VAR} 替换全链路
 * 阶段 7.7：找不到 config.toml 时返回内存默认配置（不写文件）。
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { loadConfig, _resetConfigForTest, ConfigLoadError } from "@backend/infrastructure/config/config.loader.ts";
import { join } from "@std/path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

async function withTempConfig(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = join(tmpdir(), `ai-presales-test-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.toml");
  writeFileSync(path, content);
  try {
    await fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetConfigForTest();
  }
}

const SAMPLE = `
default_profile = "fast"

[app]
name = "ai-presales"
version = "0.1.0"
data_dir = "~/.local/share/ai-presales"

[server]
host = "127.0.0.1"
port = 9000

[profiles.fast]
provider = "anthropic"
model = "claude-haiku-4-5"
temperature = 0.3
max_tokens = 2048

[profiles.local]
provider = "openai"
base_url = "http://localhost:11434/v1"
model = "qwen2.5:14b"
temperature = 0.5
max_tokens = 4096

[knowledge]
rag_top_k = 8
rag_min_score = 0.7
embedding_provider = "openai"
embedding_model = "text-embedding-3-small"
embedding_dim = 1536

[security]
tool_require_approval = ["write_file"]
allowed_paths = ["~/Documents/ai-presales/**"]

[output]
default_output_dir = "~/Documents/ai-presales/output"

[logging]
level = "warn"
max_size_mb = 20
max_backups = 3
`;

Deno.test("loadConfig - 解析合法 config", async () => {
  await withTempConfig(SAMPLE, async (path) => {
    const cfg = await loadConfig(path);
    assertEquals(cfg.app.name, "ai-presales");
    assertEquals(cfg.server.port, 9000);
    assertEquals(cfg.defaultProfile, "fast");
    assertEquals(cfg.profiles.fast.provider, "anthropic");
    assertEquals(cfg.profiles.fast.model, "claude-haiku-4-5");
    assertEquals(cfg.profiles.fast.temperature, 0.3);
    assertEquals(cfg.profiles.fast.maxTokens, 2048);
    assertEquals(cfg.profiles.local.baseUrl, "http://localhost:11434/v1");
    assertEquals(cfg.knowledge.ragTopK, 8);
    assertEquals(cfg.security.toolRequireApproval, ["write_file"]);
    assertEquals(cfg.logging.level, "warn");
  });
});

Deno.test("loadConfig - 显式指定路径且文件不存在抛 ConfigLoadError", async () => {
  _resetConfigForTest();
  await assertRejects(
    () => loadConfig("/path/this-file/does-not-exist.toml"),
    ConfigLoadError,
    "配置文件不存在",
  );
});

// 阶段 7.7（本地优先）：未显式指定路径 + cwd 没有 config.toml → 返回内存默认配置（不写文件）
Deno.test("loadConfig - 隐式路径且 cwd 无 config.toml 时返内存默认配置，不写文件", async () => {
  _resetConfigForTest();
  // 切到没有 config.toml 的临时目录跑
  const dir = join(tmpdir(), `ai-presales-fallback-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(dir);
    // APP_DATA_DIR 指到另一临时目录便于断言"不写文件"
    const dataDir = join(tmpdir(), `ai-presales-data-${crypto.randomUUID()}`);
    Deno.env.set("APP_DATA_DIR", dataDir);
    const cfg = await loadConfig();
    // 应当能解析出最小默认 appConfig
    assertEquals(cfg.app.name, "ai-presales");
    assertEquals(cfg.server.host, "127.0.0.1");
    assertEquals(cfg.server.port, 8000);
    // 没有 AI provider（profiles 为空 / defaultProfile 为空）
    assertEquals(cfg.profiles, {});
    assertEquals(cfg.defaultProfile, "");
    // dataDir 应来自 APP_DATA_DIR
    assertEquals(cfg.app.dataDir, dataDir);
    // 不应有 config.toml 落盘
    let existed = true;
    try { Deno.statSync(`${dataDir}/config.toml`); } catch (e) {
      if (e instanceof Deno.errors.NotFound) existed = false;
    }
    assertEquals(existed, false, "不应该写默认 config.toml 到 dataDir");
  } finally {
    Deno.chdir(origCwd);
    Deno.env.delete("APP_DATA_DIR");
    try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
});

Deno.test("loadConfig - default_profile 指向未定义 profile 抛错", async () => {
  // 顶层裸键必须出现在任何 [section] 之前
  const bad = `
default_profile = "nonexistent"

[app]
name = "x"
version = "0.1.0"
data_dir = "~/.local/share/x"

[profiles.fast]
provider = "anthropic"
model = "x"
temperature = 0.3
max_tokens = 2048

[output]
default_output_dir = "/tmp/x"
`;
  await withTempConfig(bad, async (path) => {
    await assertRejects(
      () => loadConfig(path),
      ConfigLoadError,
      "default_profile",
    );
  });
});

Deno.test("loadConfig - 缺 profiles 抛错", async () => {
  const bad = SAMPLE.replace(/\[profiles\.\w+\][\s\S]*?max_tokens = \d+\n/g, "");
  await withTempConfig(bad, async (path) => {
    await assertRejects(
      () => loadConfig(path),
      ConfigLoadError,
      "profile",
    );
  });
});

Deno.test("loadConfig - ${ENV_VAR} 替换", async () => {
  Deno.env.set("APP_DATA_DIR_OVERRIDE", "/custom/data");
  try {
    const withEnv = SAMPLE.replace('data_dir = "~/.local/share/ai-presales"', 'data_dir = "${APP_DATA_DIR_OVERRIDE}"');
    await withTempConfig(withEnv, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.app.dataDir, "/custom/data");
    });
  } finally {
    Deno.env.delete("APP_DATA_DIR_OVERRIDE");
  }
});

Deno.test("loadConfig - env API key 注入到 profile", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-test-anthropic");
  Deno.env.set("OPENAI_API_KEY", "sk-test-openai");
  try {
    await withTempConfig(SAMPLE, async (path) => {
      const cfg = await loadConfig(path);
      assertEquals(cfg.profiles.fast.apiKey, "sk-test-anthropic");
      assertEquals(cfg.profiles.local.apiKey, "sk-test-openai");
    });
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("loadConfig - ~/ 展开", async () => {
  await withTempConfig(SAMPLE, async (path) => {
    const cfg = await loadConfig(path);
    assertExists(cfg.app.dataDir);
    assertEquals(cfg.output.defaultOutputDir.startsWith("/"), true);
  });
});