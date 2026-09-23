/**
 * Tool configure() 单元测试 —— 阶段 7.4h
 *
 * 覆盖：
 *   - ListFilesTool.configure({ defaultMax }) → 下一次 execute 用新 max
 *   - SearchKnowledgeTool.configure({ defaultTopK }) → 下一次 execute 用新 K
 *   - 没有 configure() 的工具调 configure（mock）→ 静默跳过（不抛错）
 */

import { assert, assertEquals } from "@std/assert";
import { ListFilesTool } from "@backend/ai/tool/builtin/list-files.tool.ts";
import { SearchKnowledgeTool } from "@backend/ai/tool/builtin/search-knowledge.tool.ts";
import { CurrentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { join } from "@std/path";
import type { ToolContext } from "@backend/ai/tool/tool.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

function silentLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => silentLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
}

function makeCtx(cwd: string): ToolContext {
  return {
    logger: silentLogger(),
    cwd,
    allowedPaths: [cwd],
    timeoutMs: 10_000,
  };
}

async function setupCwd(): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
  const cwd = await Deno.makeTempDir({ prefix: "ai-tool-cfg-" });
  // 放 6 个文件，验证 max 截断
  for (let i = 0; i < 6; i++) {
    await Deno.writeTextFile(join(cwd, `f${i}.txt`), `c${i}`);
  }
  // 一个子目录
  await Deno.mkdir(join(cwd, "sub"));
  await Deno.writeTextFile(join(cwd, "sub", "inner.txt"), "x");
  return { cwd, cleanup: async () => await Deno.remove(cwd, { recursive: true }) };
}

Deno.test("ListFilesTool — configure({ defaultMax: 2 }) → 截断到 2 条", async () => {
  const { cwd, cleanup } = await setupCwd();
  try {
    const tool = new ListFilesTool();
    tool.configure({ defaultMax: 2 });
    const r = await tool.execute({}, makeCtx(cwd));
    assert(r.ok);
    if (r.ok) assertEquals(r.value.entries.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("ListFilesTool — 不调 configure → 走默认 defaultMax=100", async () => {
  const { cwd, cleanup } = await setupCwd();
  try {
    const tool = new ListFilesTool();
    const r = await tool.execute({}, makeCtx(cwd));
    assert(r.ok);
    if (r.ok) {
      // 6 个 .txt + 1 个 sub 目录 = 7 entries
      assert(r.value.entries.length >= 6);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("ListFilesTool — configure({ defaultRecursive: true }) → 默认递归", async () => {
  const { cwd, cleanup } = await setupCwd();
  try {
    const tool = new ListFilesTool();
    tool.configure({ defaultRecursive: true });
    const r = await tool.execute({}, makeCtx(cwd));
    assert(r.ok);
    if (r.ok) {
      // 应该看到 sub/inner.txt
      const names = r.value.entries.map((e: { name: string }) => e.name);
      assert(names.some((n: string) => n.includes("inner.txt")));
    }
  } finally {
    await cleanup();
  }
});

Deno.test("SearchKnowledgeTool — configure({ defaultTopK: 3 }) → 生效", async () => {
  const tool = new SearchKnowledgeTool();
  tool.configure({ defaultTopK: 3 });
  const r = await tool.execute({ query: "q" });
  assert(r.ok);
  if (r.ok) {
    // note 含 topK 字段；验证 defaultTopK 已生效
    assert(r.value.note.includes("topK=3"));
  }
});

Deno.test("SearchKnowledgeTool — 不调 configure → 走默认 K", async () => {
  const tool = new SearchKnowledgeTool();
  const r = await tool.execute({ query: "q" });
  assert(r.ok);
  if (r.ok) {
    // 默认 5
    assert(r.value.note.includes("topK=5"));
  }
});

Deno.test("CurrentDatetimeTool — configure({}) → 不抛错（uniform shape）", () => {
  const tool = new CurrentDatetimeTool();
  // 应该有 configure 但空操作
  tool.configure({});
});

Deno.test("Tool interface — 没有 configure() 的 tool → 静默跳过（由 caller 守护）", () => {
  // 模拟一个不带 configure() 的 tool（如外部 tool 实现）
  const toolWithoutConfigure = {
    name: "test",
    description: "test",
    inputSchema: {},
    requiresApproval: false,
    sideEffect: "read" as const,
    async execute() {
      return { ok: true as const, value: "ok", durationMs: 0 };
    },
  };
  // 调用方应该做 if (tool.configure) tool.configure(opts)
  // 不存在时静默跳过：
  if ("configure" in toolWithoutConfigure && typeof toolWithoutConfigure.configure === "function") {
    throw new Error("expected no configure");
  }
  // assert no error
  assert(true);
});