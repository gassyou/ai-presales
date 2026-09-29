/**
 * 任务 7：skill 调用框架 —— 测试
 *
 * 验证：
 *   - SkillRegistry：register / get / has / names / list
 *   - buildDefaultSkillRegistry 含 2 个默认 skill
 *   - toLLMSkills 输出 LLM 友好形状
 *   - skill_execute（skill_echo）真回声
 *   - skill_list_skills 列出已注册 skill
 *   - 重复 register 抛错
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { SkillRegistry, buildDefaultSkillRegistry } from "@backend/ai/skill/skill.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ToolContext } from "@backend/ai/tool/tool.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

function fakeCtx(): ToolContext {
  return {
    logger: makeLogger(),
    cwd: Deno.cwd(),
    allowedPaths: [],
    timeoutMs: 1000,
  };
}

const FAKE_SKILL = {
  name: "skill_test",
  displayName: "Test",
  description: "测试用 skill",
  inputSchema: { type: "object", properties: {} },
  async execute(_args: unknown, _ctx: ToolContext): Promise<string> {
    return "ok";
  },
};

// ====== Registry CRUD ======

Deno.test("t7 — SkillRegistry.register / get / has", () => {
  const reg = new SkillRegistry();
  reg.register(FAKE_SKILL);
  assertEquals(reg.get("skill_test")?.name, "skill_test");
  assertEquals(reg.has("skill_test"), true);
  assertEquals(reg.has("missing"), false);
});

Deno.test("t7 — SkillRegistry.names / list", () => {
  const reg = new SkillRegistry();
  reg.register(FAKE_SKILL);
  reg.register({ ...FAKE_SKILL, name: "skill_other" });
  assertEquals(new Set(reg.names()), new Set(["skill_test", "skill_other"]));
  assertEquals(reg.list().length, 2);
});

Deno.test("t7 — SkillRegistry 重复 register 抛错", () => {
  const reg = new SkillRegistry();
  reg.register(FAKE_SKILL);
  assertThrows(
    () => reg.register(FAKE_SKILL),
    Error,
    "duplicate skill name",
  );
});

Deno.test("t7 — SkillRegistry.toLLMSkills 输出 LLM 形状", () => {
  const reg = new SkillRegistry();
  reg.register(FAKE_SKILL);
  const llm = reg.toLLMSkills();
  assertEquals(llm.length, 1);
  assertEquals(llm[0].name, "skill_test");
  assertEquals(llm[0].description, "测试用 skill");
  assertEquals(llm[0].inputSchema.type, "object");
});

// ====== 默认 skill 执行 ======

Deno.test("t7 — buildDefaultSkillRegistry 含 skill_list_skills + skill_echo", () => {
  const reg = buildDefaultSkillRegistry();
  const names = reg.names();
  assert(names.includes("skill_list_skills"), `缺 skill_list_skills, got ${names}`);
  assert(names.includes("skill_echo"), `缺 skill_echo, got ${names}`);
});

Deno.test("t7 — skill_echo 回显输入", async () => {
  const reg = buildDefaultSkillRegistry();
  const skill = reg.get("skill_echo");
  assert(skill);
  const out = await skill.execute({ message: "hello" }, fakeCtx());
  assertEquals(out, "echo: hello");
});

Deno.test("t7 — skill_list_skills 列出已注册 skill", async () => {
  const reg = buildDefaultSkillRegistry();
  const skill = reg.get("skill_list_skills");
  assert(skill);
  const out = await skill.execute({}, fakeCtx());
  assert(typeof out === "string");
  assertStringIncludes(out, "skill_echo");
  assertStringIncludes(out, "skill_list_skills");
});

Deno.test("t7 — 自注册 skill 加进默认 registry 仍可用", () => {
  const reg = buildDefaultSkillRegistry();
  reg.register({ ...FAKE_SKILL, name: "skill_custom" });
  assert(reg.has("skill_custom"));
  assertEquals(reg.names().length, 3);
});