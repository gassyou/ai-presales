/**
 * 工具路径沙箱 —— 越界访问必须被拒绝
 *
 * 覆盖：
 *   - list_files: ".." 逃出 cwd → 拒绝
 *   - list_files: 绝对路径 → 拒绝
 *   - list_files: cwd 内指向 cwd 外的符号链接 → 拒绝
 *   - read_file: cwd 内指向 cwd 外的符号链接 → 拒绝
 *   - list_files / read_file: cwd 内的正常路径 → 放行
 *   - allowedPaths 显式授权的根 → 放行
 *
 * 为什么重要：list_files / read_file 的入参来自 LLM（可能被提示注入），
 * 一旦允许越界，等于把整台机器的文件系统暴露给模型。
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listFilesTool } from "@backend/ai/tool/builtin/list-files.tool.ts";
import { readFileTool } from "@backend/ai/tool/builtin/read-file.tool.ts";
import type { ToolContext } from "@backend/ai/tool/tool.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";

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

function makeCtx(cwd: string, allowedPaths: readonly string[] = []): ToolContext {
  return {
    logger: makeLogger(),
    cwd,
    allowedPaths,
    timeoutMs: 5000,
  };
}

/** 建一个"工作区 + 外部目录"，并在里面放一个指向外部的符号链接 */
async function makeFixture(): Promise<{
  work: string;
  outside: string;
  outsideFile: string;
}> {
  const work = await Deno.makeTempDir({ prefix: "sandbox_work_" });
  const outside = await Deno.makeTempDir({ prefix: "sandbox_outside_" });
  const outsideFile = join(outside, "secret.txt");
  await Deno.writeTextFile(outsideFile, "TOP SECRET");
  await Deno.writeTextFile(join(work, "ok.txt"), "hello");
  await Deno.mkdir(join(work, "sub"));
  await Deno.writeTextFile(join(work, "sub", "nested.txt"), "nested");
  // cwd 里的符号链接指向 cwd 外 —— 词法检查看不出来，必须靠 realPath 拦
  await Deno.symlink(outsideFile, join(work, "escape.txt"));
  await Deno.symlink(outside, join(work, "escape_dir"));
  return { work, outside, outsideFile };
}

// ===== list_files =====

Deno.test("list_files —— '..' 逃出 cwd → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await listFilesTool.execute({ path: "../../etc" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("traversal"), `应报 traversal，实际：${r.error}`);
});

Deno.test("list_files —— 深层 '..'（a/../../b）逃出 cwd → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await listFilesTool.execute({ path: "sub/../../etc" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("traversal"), `应报 traversal，实际：${r.error}`);
});

Deno.test("list_files —— 绝对路径 → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await listFilesTool.execute({ path: "/etc" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("absolute"), `应报 absolute，实际：${r.error}`);
});

Deno.test("list_files —— cwd 内指向外部的符号链接 → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await listFilesTool.execute({ path: "escape_dir" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("outside"), `应报 outside，实际：${r.error}`);
});

Deno.test("list_files —— cwd 内正常路径 → 放行", async () => {
  const { work } = await makeFixture();
  const r = await listFilesTool.execute({ path: "sub" }, makeCtx(work));
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assert(r.value.entries.some((e) => e.name === "nested.txt"));
});

Deno.test("list_files —— 缺省 path（= cwd）→ 放行", async () => {
  const { work } = await makeFixture();
  const r = await listFilesTool.execute({}, makeCtx(work));
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assert(r.value.entries.some((e) => e.name === "ok.txt"));
});

Deno.test("list_files —— allowedPaths 显式授权的根 → 放行", async () => {
  const { work, outside } = await makeFixture();
  const r = await listFilesTool.execute(
    { path: "." },
    makeCtx(work, [outside]),
  );
  // cwd 是 work，outside 是另一个根；"." 仍解析到 work → 放行
  assertEquals(r.ok, true);
});

// ===== read_file =====

Deno.test("read_file —— cwd 内指向外部的符号链接 → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await readFileTool.execute({ path: "escape.txt" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("outside"), `应报 outside，实际：${r.error}`);
});

Deno.test("read_file —— '..' 逃出 cwd → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await readFileTool.execute({ path: "../../etc/passwd" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("traversal"), `应报 traversal，实际：${r.error}`);
});

Deno.test("read_file —— 绝对路径 → 拒绝", async () => {
  const { work } = await makeFixture();
  const r = await readFileTool.execute({ path: "/etc/passwd" }, makeCtx(work));
  assertEquals(r.ok, false);
  if (r.ok) return;
  assert(r.error.includes("absolute"), `应报 absolute，实际：${r.error}`);
});

Deno.test("read_file —— cwd 内正常文件 → 放行", async () => {
  const { work } = await makeFixture();
  const r = await readFileTool.execute({ path: "ok.txt" }, makeCtx(work));
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.value.content, "hello");
});
