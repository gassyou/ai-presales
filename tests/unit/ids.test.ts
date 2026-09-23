/**
 * shared types & ID 生成测试
 */

import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  ProjectId,
  AiSessionId,
  newId,
  type ProjectId as ProjectIdType,
} from "@shared/types/ids.ts";

Deno.test("newId - 每次生成不同 UUID", () => {
  const a = newId<ProjectIdType>();
  const b = newId<ProjectIdType>();
  assertNotEquals(a, b);
  // 都是合法 UUID 格式
  assertEquals(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a), true);
});

Deno.test("ProjectId - 接受字符串返回 branded id", () => {
  const id = ProjectId("p-001");
  // branded type 在运行时仍是 string
  assertEquals(id as string, "p-001");
});

Deno.test("AiSessionId - 不同 ID 类型不可互换（编译期）", () => {
  // 运行时：都是 string，验证构造不抛错
  const s = AiSessionId("s-001");
  assertEquals(s as string, "s-001");
});