/**
 * 源码读取助手 —— 供"扫描源码文本做断言"的单元测试使用。
 *
 * 为什么统一行尾：
 *   这类测试用正则匹配实现源码（例如 /\n  \}\n\}/），如果工作区是 CRLF
 *   （开发者本机 core.autocrlf=true 时就会这样），正则匹配不到，
 *   测试结果取决于开发者的 git 配置而不是代码本身。
 *   统一成 LF 后，断言结果只取决于代码。
 *
 * 约定：rel 是相对仓库根的路径（Deno.cwd() 即仓库根）。
 */

import { join } from "@std/path";

/** 读仓库内相对路径的源码文件，行尾统一为 LF。 */
export function readText(rel: string): string {
  return Deno.readTextFileSync(join(Deno.cwd(), rel)).replace(/\r\n/g, "\n");
}

/**
 * 截取源码里某个函数的完整片段（从函数头到配平的大括号结束）。
 *
 * 用途：源码扫描类测试要断言"某个函数里有/没有某段代码"，
 * 用固定长度切片会因为函数变长而误判，按大括号配平取才准。
 *
 * 注意切片**从函数头开始**（含参数列表）：只切函数体会把签名丢掉，
 * 断言形参类型就得回退到整份源码去匹配，既不精确也不安全。
 */
export function functionBody(src: string, header: string): string {
  const idx = src.indexOf(header);
  if (idx < 0) throw new Error(`源码里找不到：${header}`);
  const start = src.indexOf("{", idx);
  if (start < 0) throw new Error(`找不到 ${header} 的函数体起点`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  throw new Error(`函数体大括号未配平：${header}`);
}
