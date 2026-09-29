/**
 * SkillRoute —— 阶段 13（PR #5）
 *
 * 路由：
 *   GET  /api/skills                       → 列出已注册 skill（name / displayName / description / inputSchema）
 *   POST /api/skills/:name/invoke          → 同步执行 skill，body { args: object }
 *
 * 阶段 7（任务 7）的 SkillRegistry 已存在；本 PR 在此基础上：
 *   - 暴露 GET /api/skills 给前端 slash popover 用
 *   - 暴露 POST /api/skills/:name/invoke 给前端直接触发（PR #5 不用走 LLM 的 skill 调用）
 *
 * ai.route.ts 内嵌的 slash dispatcher 拦截 /skill <name> 时也用 SkillRegistry.execute，
 * 但不走 HTTP；前后端都通过同一份 SkillRegistry 单例。
 */

import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { Skill, SkillRegistry } from "@backend/ai/skill/skill.ts";
import { type ToolContext } from "@backend/ai/tool/tool.ts";

export interface SkillRouteDeps {
  readonly registry: SkillRegistry;
  readonly logger: Logger;
}

/** GET /api/skills → 返 { items: [{name, displayName, description, inputSchema}] } */
export async function handleSkillRoute(
  req: Request,
  deps: SkillRouteDeps,
  url: URL,
): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // /api/skills/:name/invoke
  const invokeMatch = path.match(/^\/api\/skills\/([^/]+)\/invoke$/);
  if (invokeMatch) {
    const name = decodeURIComponent(invokeMatch[1]);
    if (method === "POST") return await invokeSkill(req, deps, name);
    return jsonErr(405, `method ${method} not allowed`);
  }

  // /api/skills
  if (path === "/api/skills") {
    if (method === "GET") return listSkills(deps);
    return jsonErr(405, `method ${method} not allowed`);
  }

  return jsonErr(404, "not found");
}

function listSkills(deps: SkillRouteDeps): Response {
  const items = deps.registry.list().map((s) => ({
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    inputSchema: s.inputSchema,
  }));
  return jsonOk({ items });
}

async function invokeSkill(
  req: Request,
  deps: SkillRouteDeps,
  name: string,
): Promise<Response> {
  const skill: Skill | undefined = deps.registry.get(name);
  if (!skill) {
    return jsonErr(404, `skill not found: ${name}`);
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    // 允许 body 为空 / 缺省（args = {}）
    raw = {};
  }
  const body = (raw ?? {}) as { args?: unknown };
  const args = (body.args && typeof body.args === "object") ? body.args : {};

  const ctx: ToolContext = {
    logger: deps.logger,
    cwd: Deno.cwd(),
    allowedPaths: [],
    timeoutMs: 30_000,
    signal: undefined,
  };

  try {
    const output = await skill.execute(args, ctx);
    return jsonOk({ ok: true, output });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    deps.logger.warn(`skill ${name} invoke failed`, { error: msg });
    return jsonOk({ ok: false, error: msg });
  }
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { code: "ERROR", message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
