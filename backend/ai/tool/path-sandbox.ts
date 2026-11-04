/**
 * 工具路径沙箱 —— 把工具入参里的相对路径解析成"确定落在沙箱内"的绝对路径。
 *
 * 为什么单独一个模块：
 *   list_files / read_file 都要把 LLM 给的相对路径落到磁盘上。判定规则
 *   （不许绝对路径 / 不许 ".." 逃出 / 符号链接后仍在界内）只能有一份实现，
 *   否则两个工具各写一遍必然漂移 —— 之前的 list_files 就因为漏了检查，
 *   被 ../.. 直接读到仓库外的目录。
 *
 * 规则（按顺序）：
 *   1. 入参必须是相对路径。绝对路径一定在 cwd 之外，直接拒绝。
 *   2. 归一化后不得含 ".." 段（防 a/../../b 这类绕过）。
 *   3. 解析符号链接后，真实路径必须落在 cwd 或 allowedPaths 之内
 *      （防"cwd 里的软链指向 /etc"这类词法检查看不出来的绕过）。
 *
 * 失败一律 fail-closed：拿不到真实路径就当越界处理。
 */

import { isAbsolute, join, normalize, SEPARATOR } from "@std/path";

export type SandboxPathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * 把相对路径解析成沙箱内的绝对路径。
 *
 * @param cwd 工具的工作目录（沙箱根之一）
 * @param allowedPaths 额外授权的沙箱根（配置项 security.allowed_paths）
 * @param rel 工具入参里的相对路径（空串 = cwd 本身）
 */
export async function resolveSandboxPath(
  cwd: string,
  allowedPaths: readonly string[],
  rel: string,
): Promise<SandboxPathResult> {
  const trimmed = rel.trim();

  // 1. 绝对路径直接拒绝
  if (isAbsolute(trimmed)) {
    return { ok: false, error: `absolute path not allowed: ${trimmed}` };
  }

  // 2. 归一化后不得含 ".." 段
  const norm = normalize(trimmed);
  const segments = norm.split(/[/\\]+/);
  if (segments.some((s) => s === "..")) {
    return { ok: false, error: `path traversal not allowed: ${trimmed}` };
  }

  // 3. 解析符号链接后判定是否仍在界内
  const roots = await resolveRoots(cwd, allowedPaths);
  const real = await realPath(join(cwd, norm));
  if (real === undefined) {
    return { ok: false, error: `path not found: ${norm}` };
  }
  if (!roots.some((root) => isInside(root, real))) {
    return { ok: false, error: `path outside allowed roots: ${trimmed}` };
  }
  return { ok: true, path: real };
}

/** 沙箱根：cwd + allowedPaths，全部解析成真实路径（cwd 本身可能经软链） */
async function resolveRoots(
  cwd: string,
  allowedPaths: readonly string[],
): Promise<string[]> {
  const roots: string[] = [];
  const cwdReal = await realPath(cwd);
  if (cwdReal !== undefined) roots.push(cwdReal);
  for (const p of allowedPaths) {
    const r = await realPath(p);
    if (r !== undefined) roots.push(r);
  }
  return roots;
}

/** 真实路径；路径不存在 / 不可读时返回 undefined（fail-closed） */
async function realPath(path: string): Promise<string | undefined> {
  try {
    return await Deno.realPath(path);
  } catch {
    return undefined;
  }
}

/** target 是否在 root 之内（含 root 本身） */
function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const prefix = root.endsWith(SEPARATOR) ? root : root + SEPARATOR;
  return target.startsWith(prefix);
}
