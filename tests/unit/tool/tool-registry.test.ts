/**
 * ToolRegistry 单元测试
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { currentDatetimeTool } from "@backend/ai/tool/builtin/current-datetime.tool.ts";
import { listFilesTool } from "@backend/ai/tool/builtin/list-files.tool.ts";

Deno.test("ToolRegistry —— register + get + has", () => {
  const r = new ToolRegistry();
  assertEquals(r.names().length, 0);
  r.register(currentDatetimeTool);
  assert(r.has("current_datetime"));
  assertEquals(r.get("current_datetime")?.description, currentDatetimeTool.description);
});

Deno.test("ToolRegistry —— list 返回所有", () => {
  const r = new ToolRegistry();
  r.register(currentDatetimeTool);
  r.register(listFilesTool);
  assertEquals(r.list().length, 2);
  assertEquals([...r.names()].sort(), ["current_datetime", "list_files"]);
});

Deno.test("ToolRegistry —— 重复 register 抛错", () => {
  const r = new ToolRegistry();
  r.register(currentDatetimeTool);
  assertThrows(() => r.register(currentDatetimeTool), Error, "already registered");
});

Deno.test("ToolRegistry —— toLLMTools 输出符合 LLM tools 形状", () => {
  const r = new ToolRegistry();
  r.register(currentDatetimeTool);
  const tools = r.toLLMTools();
  assertEquals(tools.length, 1);
  assertEquals(tools[0].name, "current_datetime");
  assertEquals(tools[0].inputSchema.type, "object");
});