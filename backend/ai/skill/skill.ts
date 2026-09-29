/**
 * Skill —— 阶段 7（任务 7）：AI chat 可调用的高阶操作单元
 *
 * 设计：Skill 是「LLM 显式触发的命名操作」。它的实现可包装 0 个或多个 Tool 调用，
 *       也可纯函数（如计算公式）。
 *
 * 与 Tool 的关系：
 *   - Tool 是单步原子操作（"读这个文件"）；Skill 是多步业务流（"汇总这个项目"）。
 *   - 任务 7 范围内 SkillRegistry 与 ToolRegistry 是并行的两个注册表。LLM 在 chat 时
 *     可以同时看到两者的定义。Skill 名字约定以 "skill_" 前缀，便于从 tool name 区分。
 *
 * 示例 skill（也是默认注册的两个）：
 *   - "skill_list_skills"：返回已注册 skill 的简要描述清单（让 LLM 知道自己能做什么）
 *   - "skill_echo"      ：把 args.message 原样返回（smoke test 用）
 */

import type { ToolContext } from "../tool/tool.ts";

/**
 * Skill —— AI 显式调用的命名操作
 *
 * 不复用 Tool 接口（Tool 假设单次 invoke 一次 execute，Skill 可能要编排多步）。
 * 但 exposeSchema 给 LLM 时也用同样的 JSON Schema 形状。
 */
export interface Skill<Args = unknown, R = unknown> {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /**
   * 执行 skill。ctx 与 Tool 一致（cwd / allowedPaths / signal / logger）。
   * 返回 string（成功时是给 LLM 看的内容）或 throw（失败）。
   */
  execute(args: Args, ctx: ToolContext): Promise<R>;
}

/**
 * SkillRegistry —— 阶段 7（任务 7）的最小 registry
 *
 * 极简版：register / get / has / names / list。没有 hot-reload（与 builtin-tool 路径相同）。
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`duplicate skill name: ${skill.name}`);
    }
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  names(): readonly string[] {
    return Array.from(this.skills.keys());
  }

  list(): readonly Skill[] {
    return Array.from(this.skills.values());
  }

  /** 给 LLM 看：name + description + schema */
  toLLMSkills(): Array<{
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
  }> {
    return this.list().map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: s.inputSchema,
    }));
  }
}

/** 阶段 7（任务 7）：默认 2 个 skill —— list-skills + echo */
export function buildDefaultSkillRegistry(): SkillRegistry {
  const reg = new SkillRegistry();

  reg.register({
    name: "skill_list_skills",
    displayName: "列出可用 skill",
    description:
      "返回当前可用的 skill 清单（名称 + 简述）。AI 用它自检能力边界，或在用户问「你能做什么」时调用。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      const items = reg.toLLMSkills();
      const summary = items
        .map((s) => `- ${s.name}: ${s.description.split("\n")[0]}`)
        .join("\n");
      return summary;
    },
  });

  reg.register({
    name: "skill_echo",
    displayName: "回声测试",
    description:
      "把 args.message 原样返回。用于 smoke-test skill 调用链路是否通畅。",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", description: "要回显的文本" },
      },
      additionalProperties: false,
    },
    execute: async (args: { message: string }) => {
      return `echo: ${args.message}`;
    },
  });

  return reg;
}
