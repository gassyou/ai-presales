/**
 * ToolExecutor 单元测试
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { ToolExecutor } from "@backend/ai/tool/tool-executor.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { listFilesTool } from "@backend/ai/tool/builtin/list-files.tool.ts";
import { readFileTool } from "@backend/ai/tool/builtin/read-file.tool.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import { ToolCallId } from "@shared/types/ids.ts";

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

function makeExecutor(): { exec: ToolExecutor; reg: ToolRegistry } {
  const reg = new ToolRegistry();
  reg.register(currentDatetimeTool);
  reg.register(listFilesTool);
  reg.register(readFileTool);
  const exec = new ToolExecutor({
    registry: reg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [],
    defaultTimeoutMs: 5000,
  });
  return { exec, reg };
}

Deno.test("ToolExecutor —— 工具未注册 → ok=false + error 信息", async () => {
  const { exec } = makeExecutor();
  const out = await exec.executeOne({
    toolCallId: ToolCallId("t1"),
    name: "nonexistent",
    args: {},
  });
  assertEquals(out.ok, false);
  assert(out.error?.includes("not registered"));
});

Deno.test("ToolExecutor —— current_datetime 成功执行", async () => {
  const { exec } = makeExecutor();
  const out = await exec.executeOne({
    toolCallId: ToolCallId("t1"),
    name: "current_datetime",
    args: { timezone: "UTC" },
  });
  assertEquals(out.ok, true);
  assert(out.content.includes("UTC"));
  assert(out.durationMs >= 0);
});

Deno.test("ToolExecutor —— list_files 真实目录", async () => {
  const { exec } = makeExecutor();
  const out = await exec.executeOne({
    toolCallId: ToolCallId("t1"),
    name: "list_files",
    args: { path: "backend/domain/project" },
  });
  assertEquals(out.ok, true);
  // project.ts 应在 project 子目录中
  assert(out.content.includes("project.ts"));
});

Deno.test("ToolExecutor —— executeAll 并发", async () => {
  const { exec } = makeExecutor();
  const outs = await exec.executeAll([
    { toolCallId: ToolCallId("a"), name: "current_datetime", args: {} },
    { toolCallId: ToolCallId("b"), name: "current_datetime", args: {} },
  ]);
  assertEquals(outs.length, 2);
  for (const o of outs) assertEquals(o.ok, true);
});

Deno.test("ToolExecutor —— read_file path traversal 拒绝", async () => {
  const { exec } = makeExecutor();
  const out = await exec.executeOne({
    toolCallId: ToolCallId("t1"),
    name: "read_file",
    args: { path: "../../etc/passwd" },
  });
  assertEquals(out.ok, false);
  assert(out.error?.includes("traversal"));
});

Deno.test("ToolExecutor —— read_file 读真实文件", async () => {
  const { exec } = makeExecutor();
  const out = await exec.executeOne({
    toolCallId: ToolCallId("t1"),
    name: "read_file",
    args: { path: "README.md" },
  });
  assertEquals(out.ok, true);
  assert(out.content.includes("ai-presales"));
});

// ===== 阶段 H+2：审批流 =====

function makeApprovalTool(name: string) {
  return {
    name,
    description: "approval test tool",
    inputSchema: { type: "object" },
    requiresApproval: true,
    sideEffect: "write" as const,
    async execute() {
      return { ok: true as const, value: `executed-${name}` };
    },
  };
}

function makeExecutorWithForce(opts: {
  forceApproveNames?: readonly string[];
  forceRejectNames?: readonly string[];
}): ToolExecutor {
  const reg = new ToolRegistry();
  reg.register(makeApprovalTool("write_x"));
  reg.register(makeApprovalTool("write_y"));
  reg.register(currentDatetimeTool);
  return new ToolExecutor({
    registry: reg,
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [],
    defaultTimeoutMs: 5000,
    ...(opts.forceApproveNames !== undefined ? { forceApproveNames: opts.forceApproveNames } : {}),
    ...(opts.forceRejectNames !== undefined ? { forceRejectNames: opts.forceRejectNames } : {}),
  });
}

Deno.test("ToolExecutor —— requiresApproval=true 无 force → 返 awaitingApproval", async () => {
  const exec = makeExecutorWithForce({});
  const out = await exec.executeOne({
    toolCallId: ToolCallId("a1"),
    name: "write_x",
    args: {},
  });
  assertEquals(out.ok, false);
  assertEquals(out.error, "APPROVAL_REQUIRED");
  assertEquals(out.awaitingApproval, true);
});

Deno.test("ToolExecutor —— forceApproveNames 命中 → 跳过审批真执行", async () => {
  const exec = makeExecutorWithForce({ forceApproveNames: ["write_x"] });
  const out = await exec.executeOne({
    toolCallId: ToolCallId("a1"),
    name: "write_x",
    args: {},
  });
  assertEquals(out.ok, true);
  assert(out.content.includes("executed-write_x"));
});

Deno.test("ToolExecutor —— forceRejectNames 命中 → USER_REJECTED，不真执行", async () => {
  const exec = makeExecutorWithForce({ forceRejectNames: ["write_x"] });
  const out = await exec.executeOne({
    toolCallId: ToolCallId("a1"),
    name: "write_x",
    args: {},
  });
  assertEquals(out.ok, false);
  assertEquals(out.error, "USER_REJECTED");
});

Deno.test("ToolExecutor —— executeAll 混合：未 force 的等审批 + force 真执行", async () => {
  const exec = makeExecutorWithForce({ forceApproveNames: ["write_x"] });
  const outs = await exec.executeAll([
    { toolCallId: ToolCallId("a"), name: "write_x", args: {} },
    { toolCallId: ToolCallId("b"), name: "write_y", args: {} },
    { toolCallId: ToolCallId("c"), name: "current_datetime", args: {} },
  ]);
  assertEquals(outs.length, 3);
  assertEquals(outs[0].ok, true);
  assertEquals(outs[1].ok, false);
  assertEquals(outs[1].awaitingApproval, true);
  assertEquals(outs[2].ok, true);
});